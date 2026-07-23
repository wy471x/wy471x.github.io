---
layout: post
title: "Nginx 源码阅读指南"
date: 2026-07-23 23:45:00 +0800
categories: Nginx
tags: Nginx 源码 C
lang: zh
ref: nginx-source-code-guide
summary: "Nginx 源码阅读指南 - 从环境搭建、核心数据结构、进程模型到 HTTP 请求处理全链路的系统化阅读路线"
---

# Nginx 源码阅读指南

## 一、读前准备

### 1.1 必备知识

- **C 语言**：熟悉指针、函数指针、宏、位运算、结构体内存布局（`offsetof`）、变长参数
- **网络编程**：TCP/IP、HTTP/1.1 协议、socket API（`accept`/`recv`/`send`/`setsockopt`）、非阻塞 I/O
- **操作系统**：进程模型（fork）、信号（signal）、共享内存、epoll/kqueue 等多路复用机制
- **编译工具**：能读懂 shell 脚本和 Makefile

### 1.2 环境搭建

```bash
# 编译带调试信息的 nginx
./auto/configure --with-debug --prefix=$(pwd)/build
make -j$(nproc)

# 用 GDB 调试
gdb ./objs/nginx
(gdb) b ngx_process_events_and_timers
(gdb) r
```

### 1.3 关键宏与惯例速查

| 宏/模式 | 含义 |
|---------|------|
| `NGX_OK` / `NGX_ERROR` / `NGX_AGAIN` / `NGX_DECLINED` / `NGX_DONE` / `NGX_BUSY` / `NGX_ABORT` | 标准返回值，分别对应 0/-1/-2/-5/-4/-3/-6 |
| `ngx_string("foo")` | 编译期从字面量构造 `ngx_str_t` |
| `ngx_queue_data(q, type, link)` | 从侵入式队列节点反查包含它的结构体 |
| `ngx_rbtree_data(node, type, link)` | 同上，针对红黑树节点 |
| `ngx_log_debug` / `ngx_log_error` | 分级日志宏，带 `--with-debug` 才会输出 debug 级别 |
| `offsetof(type, member)` | 计算成员在结构体中的偏移量，侵入式数据结构的基石 |

---

## 二、推荐阅读路线

### 第 0 步：理解构建系统（30 分钟）

从 `auto/` 目录开始，不必细读每个脚本，重点是理解流程：

1. **`auto/configure`** — 入口，顺序调用 `auto/options`、`auto/init`、`auto/cc/*`、`auto/os/*`、`auto/feature`、`auto/modules`、`auto/sources`、`auto/make`
2. **`auto/modules`** — 最关键的文件之一。它决定哪些模块被编译进 `ngx_modules[]` 数组，**模块的排列顺序决定了初始化顺序和处理优先级，不可随意改动**
3. **`auto/sources`** — 定义了所有源文件列表的 shell 变量（`CORE_SRCS`、`HTTP_SRCS` 等），最终输出到 `objs/Makefile`

构建产物：
- `objs/ngx_auto_config.h` — 所有 `#define` 宏（编译特性开关）
- `objs/ngx_modules.c` — 自动生成的 `ngx_modules[]` 和 `ngx_module_names[]`

### 第 1 步：核心数据结构（2-3 小时）

**这是最重要的基础，务必吃透。** 按依赖关系建议顺序：

```
ngx_str_t  →  ngx_pool_t  →  ngx_array_t  →  ngx_list_t  →  ngx_queue_t  →  ngx_buf_t / ngx_chain_t  →  ngx_rbtree_t
```

逐个阅读文件：

| 阅读文件 | 重点理解 |
|---------|---------|
| `src/core/ngx_string.h` | `ngx_str_t` 不是 C 字符串，`len` + `data` 二元组；`ngx_vslprintf` 等格式化函数 |
| `src/core/ngx_palloc.h` + `ngx_palloc.c` | 池分配器：小块从池中切，大块走 malloc；`ngx_palloc` vs `ngx_pnalloc`（对齐 vs 不对齐）；cleanup 回调机制 |
| `src/core/ngx_array.h` | 动态数组，元素连续存储，`ngx_array_push` 返回新元素的指针 |
| `src/core/ngx_list.h` | 链表+数组的混合体，每个 `part` 存放 `nalloc` 个元素 |
| `src/core/ngx_queue.h` | **纯粹的宏**，侵入式双向循环链表，核心宏 `ngx_queue_data` 用 `offsetof` 反查容器 |
| `src/core/ngx_buf.h` + `ngx_buf.c` | `ngx_buf_t` 统一了内存数据和文件数据；`ngx_chain_t` 构成数据流水线 |
| `src/core/ngx_rbtree.h` + `ngx_rbtree.c` | 红黑树，哨兵节点代替 NULL，自定义插入函数，`ngx_rbtree_data` 反查容器 |

### 第 2 步：进程模型与事件循环（2-3 小时）

这是理解 nginx 运行时行为的核心。

**阅读顺序**：

1. **`src/os/unix/ngx_process_cycle.c`** — `main()` 之后的真正入口
   - `ngx_master_process_cycle()` — master 进程循环（信号处理、worker 管理）
   - `ngx_single_process_cycle()` — 单进程模式（调试用）
   - `ngx_worker_process_cycle()` — **worker 进程的主循环**（最关键的阅读目标）
   - `ngx_start_worker_processes()` — 如何 fork worker
   - 重点关注：热更新（HUP 信号）时新旧 worker 的切换逻辑

2. **`src/event/ngx_event.c`** — 事件子系统核心
   - `ngx_event_process_init()` — worker 启动时的事件初始化（创建连接池、事件池）
   - **`ngx_process_events_and_timers()`** — 事件循环的心脏，每次循环执行四个步骤：
     ```
     ① ngx_event_find_timer()       -- 从红黑树找出最近到期的定时器
     ② ngx_process_events()         -- 调用 epoll_wait / kqueue 等
     ③ ngx_event_expire_timers()    -- 处理到期定时器
     ④ ngx_event_process_posted()   -- 处理延迟执行的 posted 事件
     ```

3. **`src/event/ngx_event_timer.h`** — 定时器管理
   - 全局红黑树 `ngx_event_timer_rbtree`，键值为 `到期时间 = ngx_current_msec + delay`
   - 惰性延迟优化：阈值 300ms，避免频繁更新红黑树

4. **`src/event/ngx_event_posted.h`** — 延迟事件机制
   - 三个全局队列：`ngx_posted_accept_events`、`ngx_posted_events`、`ngx_posted_next_events`
   - 用于避免重入和批量化处理

### 第 3 步：连接管理（1-2 小时）

1. **`src/core/ngx_connection.h`** — 两个核心结构体
   - `ngx_connection_t`：每条连接一个实例，包含 fd、读写事件、I/O 函数指针（被 SSL/QUIC 替换）、状态位
   - `ngx_listening_t`：每个监听 socket 一个实例，包含接受回调、SSL/QUIC 标记

2. **`src/core/ngx_connection.c`**
   - `ngx_open_listening_sockets()` — 打开所有监听端口
   - `ngx_get_connection()` — 从预分配数组中取空闲连接
   - `ngx_close_connection()` — 归还连接到空闲列表

3. **`src/event/ngx_event_accept.c`**
   - `ngx_event_accept()` — accept 处理器，accept 互斥锁逻辑

关键设计：**instance 位**解决 stale event 问题
```
每次连接复用时，instance 位翻转。
当 epoll/kqueue 返回一个过时的事件时，
通过比对 instance 位发现不匹配 → 丢弃该事件。
这避免了额外系统调用来验证事件有效性。
```

### 第 4 步：配置系统（2 小时）

nginx 的配置解析器是一个**递归下降解析器**，是整个模块系统运转的基础。

1. **`src/core/ngx_conf_file.h`** — 核心类型
   - `ngx_command_t`：每个配置指令的定义（名称、参数规则、set 函数、偏移量）
   - `ngx_conf_t`：解析上下文

2. **`src/core/ngx_conf_file.c`**
   - **`ngx_conf_parse()`** — 递归解析入口，遇到 block 指令会递归调用自身
   - `ngx_conf_handler()` — 分发到模块的 set 函数

3. **参数类型标志速查**：
   ```
   NGX_CONF_NOARGS         -- 无参数（如 "accept_mutex off;" 中的 off 是 flag，不是参数）
   NGX_CONF_TAKE1~7        -- 正好 N 个参数
   NGX_CONF_TAKE12         -- 1 或 2 个参数
   NGX_CONF_FLAG           -- 布尔值（on/off）
   NGX_CONF_BLOCK          -- 后面跟着 {} 块
   NGX_CONF_1MORE          -- 至少 1 个参数
   ```

4. **Setter 函数族**：`ngx_conf_set_flag_slot`、`ngx_conf_set_str_slot`、`ngx_conf_set_num_slot`、`ngx_conf_set_size_slot`、`ngx_conf_set_msec_slot` 等，这些是配置解析的基础组件。

5. **配置合并宏**：
   ```c
   ngx_conf_merge_value(conf, prev, default)   // 数值：当前 → 父级 → 默认
   ngx_conf_merge_str_value(conf, prev, default)
   ngx_conf_merge_msec_value(conf, prev, default)
   ```
   体现了 nginx 配置继承的三级 fallback 机制。

### 第 5 步：模块系统（1-2 小时）

1. **`src/core/ngx_module.h`** — `ngx_module_t` 结构体
   - 全局索引 `index` 和类型内索引 `ctx_index`
   - 类型特定的 `ctx` 指针
   - `commands` 数组（配置指令定义）
   - 生命周期钩子：`init_master` → `init_module` → `init_process` → `exit_process` → `exit_master`

2. **模块类型**：
   ```
   NGX_CORE_MODULE    -- 核心模块（如 ngx_core_module、ngx_events_module、ngx_http_module）
   NGX_EVENT_MODULE   -- 事件模块（如 ngx_epoll_module、ngx_kqueue_module）
   NGX_HTTP_MODULE    -- HTTP 模块
   NGX_MAIL_MODULE    -- Mail 模块
   NGX_STREAM_MODULE  -- Stream 模块
   ```

3. **`src/core/ngx_module.c`**
   - `ngx_cycle_modules()` — 复制模块数组到 cycle
   - `ngx_init_modules()` — 调用每个模块的 `init_module`

4. **HTTP 模块的特殊上下文** `ngx_http_module_t`：
   ```c
   typedef struct {
       ngx_int_t   (*preconfiguration)(ngx_conf_t *cf);
       ngx_int_t   (*postconfiguration)(ngx_conf_t *cf);
       void       *(*create_main_conf)(ngx_conf_t *cf);
       char       *(*init_main_conf)(ngx_conf_t *cf, void *conf);
       void       *(*create_srv_conf)(ngx_conf_t *cf);
       char       *(*merge_srv_conf)(ngx_conf_t *cf, void *prev, void *conf);
       void       *(*create_loc_conf)(ngx_conf_t *cf);
       char       *(*merge_loc_conf)(ngx_conf_t *cf, void *prev, void *conf);
   } ngx_http_module_t;
   ```
   **这是理解 HTTP 模块如何工作的关键**：main → srv → loc 三级配置的创建和合并都在这里。

### 第 6 步：HTTP 请求处理全链路（4-5 小时）⭐ 核心

这是 nginx 源码中最重要、最复杂的部分，建议反复阅读。

#### 6.1 HTTP 框架初始化

**`src/http/ngx_http.c`**
- `ngx_http_block()` — `http {}` 块的解析函数
  - 创建 main/srv/loc 三级配置
  - 初始化 phase engine（阶段引擎）
  - 调用各模块的 `postconfiguration`（此时注册 handler、filter）
  - 初始化请求头解析表、变量系统

#### 6.2 11 个处理阶段

**`src/http/ngx_http_core_module.h`**

```
NGX_HTTP_POST_READ_PHASE       -- 读完请求头之后（realip 模块在此）
NGX_HTTP_SERVER_REWRITE_PHASE  -- server 级别的 rewrite
NGX_HTTP_FIND_CONFIG_PHASE     -- 匹配 location
NGX_HTTP_REWRITE_PHASE         -- location 级别的 rewrite
NGX_HTTP_POST_REWRITE_PHASE    -- rewrite 之后（检查重定向循环）
NGX_HTTP_PREACCESS_PHASE       -- 访问限制（limit_conn、limit_req）
NGX_HTTP_ACCESS_PHASE          -- 权限检查（allow/deny、auth_basic、auth_request）
NGX_HTTP_POST_ACCESS_PHASE     -- access 之后（处理 satisfy all/any）
NGX_HTTP_PRECONTENT_PHASE      -- 内容产生之前（mirror、try_files）
NGX_HTTP_CONTENT_PHASE         -- 产生响应内容（proxy_pass、fastcgi_pass、static）
NGX_HTTP_LOG_PHASE             -- 记录日志（请求处理完成之后）
```

每个阶段由 **checker 函数** 驱动，依次调用注册到该阶段的 handler。关键 checker：

| Checker | 阶段 | 行为 |
|---------|------|------|
| `ngx_http_core_generic_phase` | rewrite 等 | 顺序执行，DECLINED 则下一个 |
| `ngx_http_core_find_config_phase` | find_config | 匹配 location，只执行一次 |
| `ngx_http_core_access_phase` | access | 支持 satisfy all/any |
| `ngx_http_core_content_phase` | content | 找到第一个返回 OK 的 handler |

阅读入口：**`ngx_http_core_run_phases()`**

#### 6.3 请求生命周期

**`src/http/ngx_http_request.h`** — `ngx_http_request_t` 结构体（很大，约 60+ 字段）

**`src/http/ngx_http_request.c`** — 按顺序阅读以下函数：

```
新连接到达：
  ngx_http_init_connection()
    → ngx_http_wait_request_handler()      -- 等待完整的请求头到达

请求头解析完成：
  ngx_http_process_request_line()
    → ngx_http_process_request_headers()
      → ngx_http_process_request()
        → ngx_http_process_request_headers()  -- 解析 Host、Content-Length 等
        → ngx_http_handler()                  -- 设置 r->phase_handler = 0
          → ngx_http_core_run_phases(r)       -- 驱动阶段引擎

响应发送：
  ngx_http_writer()                         -- 异步发送响应体

请求结束：
  ngx_http_finalize_request()
    → ngx_http_free_request()
      → ngx_destroy_pool(r->pool)          -- 销毁请求内存池
```

#### 6.4 过滤器链

nginx 的输出不是由单个模块一次性完成的，而是通过**过滤器链**（责任链模式）协作产生的。

**头过滤器链**：
```
ngx_http_top_header_filter
  → ngx_http_not_modified_header_filter
  → ...
  → ngx_http_gzip_header_filter
  → ...
  → ngx_http_header_filter          -- 最终序列化 HTTP 头为字节流
```

**体过滤器链**：
```
ngx_http_top_body_filter
  → ngx_http_range_body_filter
  → ngx_http_copy_filter            -- 必要时将 in_file buf 复制到内存
  → ngx_http_gzip_body_filter
  → ngx_http_chunked_body_filter
  → ngx_http_write_filter           -- 最终调用 c->send_chain() 发送
```

过滤器注册模式：
```c
// 在 postconfiguration 中注册：
static ngx_int_t
ngx_http_my_init(ngx_conf_t *cf)
{
    ngx_http_next_header_filter  = ngx_http_top_header_filter;
    ngx_http_top_header_filter   = ngx_http_my_header_filter;

    ngx_http_next_body_filter    = ngx_http_top_body_filter;
    ngx_http_top_body_filter     = ngx_http_my_body_filter;

    return NGX_OK;
}
```
注意：**后注册的先执行**（因为每次插在链头）。

#### 6.5 Location 匹配

**`src/http/ngx_http_core_module.c`**

`ngx_http_core_find_config_phase()` 中的匹配算法：
1. 用 `ngx_hash_lookup()` 在 `locations` 哈希表中做**前缀匹配**
2. 如果匹配到的 location 有嵌套，递归查找
3. 最后用 `regex_locations` 队列做**正则匹配**（优先级最高，使用 `=~` 或 `~*`）

**配置合并的路径**：匹配到某个 location 后，其 `loc_conf[module_index]` 已在解析阶段通过 `merge_loc_conf` 正确地继承自 server 和 main 级别的配置。

#### 6.6 Upstream 机制

**`src/http/ngx_http_upstream.h`** + **`src/http/ngx_http_upstream.c`**

upstream 的状态机：
```
ngx_http_upstream_init()
  → ngx_http_upstream_connect()           -- 建立到后端的连接
    → ngx_http_upstream_send_request()    -- 发送请求体
      → ngx_http_upstream_process_header()  -- 解析响应头
        → ngx_http_upstream_process_body_in_memory() 或 sendfile/pipe -- 转发响应体
          → ngx_http_upstream_finalize_request()
```

负载均衡是**可插拔**的，通过 `ngx_http_upstream_peer_t` 接口：
- `ngx_http_upstream_round_robin.c` — 加权轮询（默认）
- `ngx_http_upstream_hash_module.c` — 一致性哈希
- `ngx_http_upstream_least_conn_module.c` — 最小连接数
- `ngx_http_upstream_random_module.c` — 随机选择

### 第 7 步：补充阅读（按需）

1. **日志系统**：`src/core/ngx_log.h` + `ngx_log.c` — `ngx_log_t` 分级日志，链式日志对象
2. **变量系统**：`src/http/ngx_http_variables.c` — `$remote_addr`、`$host` 等变量如何注册和求值
3. **正则引擎**：`src/core/ngx_regex.c` — 对 PCRE 的封装（nginx 自己不做正则引擎）
4. **共享内存与 Slab 分配器**：`src/core/ngx_slab.c` — 用于多进程共享数据的 slab 分配器
5. **SSL/TLS**：`src/event/ngx_event_openssl.c` — 如何通过替换 `c->recv/send` 函数指针实现 SSL
6. **HTTP/2**：`src/http/v2/` — HTTP/2 帧的解析和多路复用
7. **QUIC/HTTP/3**：`src/event/quic/` + `src/http/v3/` — QUIC 传输层和 HTTP/3 的实现

---

## 三、贯穿始终的设计模式与思维方式

### 3.1 侵入式数据结构

nginx 不单独分配链表节点或树节点，而是将 `ngx_queue_t` 和 `ngx_rbtree_node_t` **直接嵌入**在使用它们的结构体中。零额外分配，极致效率。

```c
// 不是：list<Item*> items（每次插入要 malloc 一个节点）
// 而是：Item 里包含 ngx_queue_t queue，直接链入
```

### 3.2 预分配 + 重用

连接、事件、内存池——在启动时预分配好，运行时不再 `malloc`。nginx 的哲学是：**"我能在启动时算清楚的最大资源量，就预分配好"**。

### 3.3 I/O 函数指针的多态

```c
c->recv = ngx_ssl_recv;   // SSL 模块偷偷换了
c->send = ngx_ssl_send;
```
高层代码（HTTP 框架）完全不感知底层是 TCP 还是 SSL 还是 QUIC，这是 nginx 实现协议升级和 SSL 透明的关键手段。

### 3.4 返回值驱动的控制流

nginx 不使用异常或 `goto`，而是通过返回值表达控制意图：

| 返回值 | 语义 |
|-------|------|
| `NGX_OK` | 完成，调用者继续 |
| `NGX_ERROR` | 出错，终止 |
| `NGX_AGAIN` | 资源不足（缓冲满了、数据未到），暂停等待下次事件触发 |
| `NGX_DECLINED` | 我不处理，找下一个（handler 单链表遍历的核心） |
| `NGX_DONE` | 已处理，但请求未结束（异步操作 pending） |
| `NGX_BUSY` | 忙，稍后再试 |

理解 `NGX_AGAIN` 和 `NGX_DECLINED` 的区别特别重要——前者是"等一会儿我重试"，后者是"换下一个"。

### 3.5 优雅的零停机

配置重载（`nginx -s reload`）的核心逻辑：

1. Master 收到 `SIGHUP` → 创建新 `ngx_cycle_t`，fork 新 worker
2. 旧 worker 收到 `SIGQUIT` → 优雅关闭（处理完现有连接再退出）
3. 新旧 worker 短暂共存，旧 worker 关闭后新 cycle 接管

这依赖于 `cycle->old_cycle` 的设计：新 cycle 持有旧 cycle 引用，等旧 worker 退出后释放。

---

## 四、调试技巧

### 4.1 Debug 日志

编译时带 `--with-debug`，然后在配置中设置：
```nginx
error_log /var/log/nginx/debug.log debug;
```

### 4.2 GDB 常用断点

```gdb
# 事件循环入口
b ngx_process_events_and_timers

# 请求处理入口
b ngx_http_process_request

# 阶段引擎
b ngx_http_core_run_phases

# 连接分配
b ngx_get_connection

# upstream 连接
b ngx_http_upstream_connect

# 一个连接上的所有 recv/send 调用
b ngx_unix_recv
b ngx_unix_send
```

### 4.3 打印 ngx_str_t

```gdb
# ngx_str_t 不是 C 字符串，在 GDB 中需要自定义打印
define print_ngx_str
  set $s = (ngx_str_t*)$arg0
  printf "%.*s\n", $s->len, $s->data
end
```

### 4.4 追踪内存分配

在 `src/core/ngx_palloc.c` 的关键函数打断点：
- `ngx_create_pool` — 池创建
- `ngx_palloc` — 小块分配
- `ngx_palloc_block` — 分配新池块
- `ngx_pfree` — 大块释放
- `ngx_destroy_pool` — 池销毁

---

## 五、建议的阅读实践

1. **不要试图按文件序号从头读到尾**。nginx 的静态函数和全局变量很多，按头文件依赖关系去读。
2. **每次只追踪一个功能链路**。比如 "一个 HTTP GET 请求从接收到返回的完整路径"，只关注这条线上的函数，忽略旁路。
3. **画图**。nginx 源码中的结构体嵌套很深，手绘以下关系图会很有帮助：
   - `ngx_cycle_t` → `conf_ctx` → 各模块配置的索引关系
   - `ngx_connection_t` → `read` / `write` → `ngx_event_t` → `handler` 的调用链
   - HTTP 阶段引擎中 checker → handler → next 的跳转关系
   - 过滤器链中 `ngx_http_top_header_filter` → `next` → ... 的顺序
4. **从简单的第三方模块入手**。阅读 `src/http/modules/ngx_http_echo_module.c` 级别的简单模块，理解 handler 和 filter 怎么写。
5. **对比阅读**。在 `src/http/modules/` 下找两个类似功能的模块对比（如 proxy vs fastcgi），理解差异在哪里。
6. **重复读核心函数**。`ngx_process_events_and_timers()`、`ngx_http_core_run_phases()`、`ngx_conf_parse()`、`ngx_http_upstream_connect()` 这几个函数值得反复读，每次都会发现新细节。

---

## 六、核心文件索引

| 文件 | 阅读优先级 | 核心内容 |
|------|:---:|---------|
| `src/core/nginx.c` | ★★★ | `main()` 入口 |
| `src/core/ngx_cycle.c` | ★★★ | `ngx_init_cycle()` 循环初始化 |
| `src/core/ngx_palloc.c` | ★★★ | 内存池实现 |
| `src/core/ngx_buf.c` | ★★★ | buffer 和 chain 操作 |
| `src/core/ngx_connection.c` | ★★★ | 连接预分配和管理 |
| `src/core/ngx_conf_file.c` | ★★★ | 配置解析器 |
| `src/core/ngx_module.c` | ★★★ | 模块加载和初始化 |
| `src/core/ngx_string.c` | ★★☆ | 字符串工具函数集 |
| `src/core/ngx_array.h` | ★★★ | 动态数组 |
| `src/core/ngx_list.h` | ★★★ | 链表+数组混合 |
| `src/core/ngx_queue.h` | ★★★ | 侵入式双向链表 |
| `src/core/ngx_rbtree.c` | ★★☆ | 红黑树 |
| `src/core/ngx_hash.c` | ★★☆ | 静态哈希表 |
| `src/core/ngx_log.c` | ★★☆ | 日志系统 |
| `src/os/unix/ngx_process_cycle.c` | ★★★ | master/worker 进程管理 |
| `src/event/ngx_event.c` | ★★★ | 事件循环核心 |
| `src/event/ngx_event_accept.c` | ★★☆ | accept 与惊群处理 |
| `src/event/ngx_event_timer.h` | ★★☆ | 定时器管理 |
| `src/event/modules/ngx_epoll_module.c` | ★★☆ | epoll 事件模块 |
| `src/http/ngx_http.c` | ★★★ | HTTP 框架初始化 |
| `src/http/ngx_http_request.c` | ★★★ | 请求生命周期 |
| `src/http/ngx_http_core_module.c` | ★★★ | 核心指令、phase checker |
| `src/http/ngx_http_upstream.c` | ★★★ | upstream 代理机制 |
| `src/http/ngx_http_variables.c` | ★★☆ | 变量系统 |
| `src/http/ngx_http_header_filter.c` | ★★☆ | 响应头序列化 |
| `src/http/ngx_http_write_filter.c` | ★★☆ | 最终发送到 socket |
| `src/http/modules/ngx_http_proxy_module.c` | ★★☆ | 典型 HTTP 代理模块 |
| `src/http/modules/ngx_http_static_module.c` | ★☆☆ | 最简单的 content handler |

---

> **最后建议**：读 nginx 源码是一场马拉松，不是短跑。核心代码大约 10 万行，但设计高度一致，一旦掌握了前 30% 的模式，剩下的 70% 会提速很快。祝阅读顺利。
