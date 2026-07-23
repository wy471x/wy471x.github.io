---
layout: post
title: "Nginx Source Code Reading Guide"
date: 2026-07-23 23:45:00 +0800
categories: Nginx
tags: Nginx Source-Code C
lang: en
ref: nginx-source-code-guide
permalink: /en/2026-07-23/nginx-source-code-guide.html
summary: "A systematic guide to reading Nginx source code - from environment setup and core data structures to process model and HTTP request handling"
---

# Nginx Source Code Reading Guide

## 1. Preparation

### 1.1 Prerequisites

- **C Language**: pointers, function pointers, macros, bitwise operations, struct memory layout (`offsetof`), variadic arguments
- **Network Programming**: TCP/IP, HTTP/1.1 protocol, socket API (`accept`/`recv`/`send`/`setsockopt`), non-blocking I/O
- **Operating Systems**: process model (fork), signals, shared memory, epoll/kqueue multiplexing mechanisms
- **Build Tools**: ability to read shell scripts and Makefiles

### 1.2 Environment Setup

```bash
# Build nginx with debug info
./auto/configure --with-debug --prefix=$(pwd)/build
make -j$(nproc)

# Debug with GDB
gdb ./objs/nginx
(gdb) b ngx_process_events_and_timers
(gdb) r
```

### 1.3 Key Macros and Conventions Quick Reference

| Macro/Pattern | Meaning |
|---------|------|
| `NGX_OK` / `NGX_ERROR` / `NGX_AGAIN` / `NGX_DECLINED` / `NGX_DONE` / `NGX_BUSY` / `NGX_ABORT` | Standard return values: 0/-1/-2/-5/-4/-3/-6 |
| `ngx_string("foo")` | Compile-time construction of `ngx_str_t` from a literal |
| `ngx_queue_data(q, type, link)` | Retrieve the containing struct from an intrusive queue node |
| `ngx_rbtree_data(node, type, link)` | Same as above, for rbtree nodes |
| `ngx_log_debug` / `ngx_log_error` | Leveled logging macros; debug level only output with `--with-debug` |
| `offsetof(type, member)` | Calculate the offset of a member within a struct — the cornerstone of intrusive data structures |

---

## 2. Recommended Reading Roadmap

### Step 0: Understand the Build System (30 min)

Start from the `auto/` directory. No need to read every script in detail — focus on understanding the flow:

1. **`auto/configure`** — Entry point, sequentially calls `auto/options`, `auto/init`, `auto/cc/*`, `auto/os/*`, `auto/feature`, `auto/modules`, `auto/sources`, `auto/make`
2. **`auto/modules`** — One of the most critical files. It determines which modules are compiled into the `ngx_modules[]` array. **The ordering of modules determines initialization order and processing priority — never change it casually**
3. **`auto/sources`** — Defines shell variables listing all source files (`CORE_SRCS`, `HTTP_SRCS`, etc.), ultimately output to `objs/Makefile`

Build artifacts:
- `objs/ngx_auto_config.h` — All `#define` macros (compile-time feature switches)
- `objs/ngx_modules.c` — Auto-generated `ngx_modules[]` and `ngx_module_names[]`

### Step 1: Core Data Structures (2-3 hours)

**This is the most important foundation — master it thoroughly.** Suggested order by dependency:

```
ngx_str_t  →  ngx_pool_t  →  ngx_array_t  →  ngx_list_t  →  ngx_queue_t  →  ngx_buf_t / ngx_chain_t  →  ngx_rbtree_t
```

Read file by file:

| File | Key Focus |
|---------|---------|
| `src/core/ngx_string.h` | `ngx_str_t` is not a C string — it's a `len` + `data` pair; `ngx_vslprintf` and other formatting functions |
| `src/core/ngx_palloc.h` + `ngx_palloc.c` | Pool allocator: small blocks carved from pool, large blocks via malloc; `ngx_palloc` vs `ngx_pnalloc` (aligned vs unaligned); cleanup callback mechanism |
| `src/core/ngx_array.h` | Dynamic array, elements stored contiguously; `ngx_array_push` returns a pointer to the new element |
| `src/core/ngx_list.h` | Hybrid of linked list + array; each `part` holds `nalloc` elements |
| `src/core/ngx_queue.h` | **Pure macros**, intrusive doubly-linked circular list; the core macro `ngx_queue_data` uses `offsetof` to retrieve the container |
| `src/core/ngx_buf.h` + `ngx_buf.c` | `ngx_buf_t` unifies memory data and file data; `ngx_chain_t` forms a data pipeline |
| `src/core/ngx_rbtree.h` + `ngx_rbtree.c` | Red-black tree, sentinel node instead of NULL, custom insert function; `ngx_rbtree_data` retrieves the container |

### Step 2: Process Model and Event Loop (2-3 hours)

This is the core of understanding nginx runtime behavior.

**Reading order**:

1. **`src/os/unix/ngx_process_cycle.c`** — The real entry point after `main()`
   - `ngx_master_process_cycle()` — Master process loop (signal handling, worker management)
   - `ngx_single_process_cycle()` — Single process mode (for debugging)
   - `ngx_worker_process_cycle()` — **The main loop of a worker process** (most critical reading target)
   - `ngx_start_worker_processes()` — How workers are forked
   - Key focus: the switching logic between old and new workers during hot reload (HUP signal)

2. **`src/event/ngx_event.c`** — Event subsystem core
   - `ngx_event_process_init()` — Event initialization when a worker starts (creates connection pool, event pool)
   - **`ngx_process_events_and_timers()`** — The heart of the event loop, four steps per iteration:
     ```
     ① ngx_event_find_timer()       -- Find the soonest-expiring timer from the rbtree
     ② ngx_process_events()         -- Call epoll_wait / kqueue etc.
     ③ ngx_event_expire_timers()    -- Process expired timers
     ④ ngx_event_process_posted()   -- Process deferred posted events
     ```

3. **`src/event/ngx_event_timer.h`** — Timer management
   - Global rbtree `ngx_event_timer_rbtree`, keyed by `expiry = ngx_current_msec + delay`
   - Lazy delay optimization: 300ms threshold to avoid frequent rbtree updates

4. **`src/event/ngx_event_posted.h`** — Deferred event mechanism
   - Three global queues: `ngx_posted_accept_events`, `ngx_posted_events`, `ngx_posted_next_events`
   - Used to avoid reentrancy and enable batch processing

### Step 3: Connection Management (1-2 hours)

1. **`src/core/ngx_connection.h`** — Two core structs
   - `ngx_connection_t`: One instance per connection, contains fd, read/write events, I/O function pointers (swapped by SSL/QUIC), status bits
   - `ngx_listening_t`: One instance per listening socket, contains accept callback, SSL/QUIC flags

2. **`src/core/ngx_connection.c`**
   - `ngx_open_listening_sockets()` — Open all listening ports
   - `ngx_get_connection()` — Get a free connection from the pre-allocated array
   - `ngx_close_connection()` — Return a connection to the free list

3. **`src/event/ngx_event_accept.c`**
   - `ngx_event_accept()` — Accept handler, accept mutex logic

Key design: **instance bit** solves the stale event problem
```
Every time a connection is reused, the instance bit flips.
When epoll/kqueue returns a stale event,
the instance bit mismatch is detected → the event is discarded.
This avoids extra syscalls to verify event validity.
```

### Step 4: Configuration System (2 hours)

nginx's configuration parser is a **recursive descent parser** — the foundation upon which the entire module system operates.

1. **`src/core/ngx_conf_file.h`** — Core types
   - `ngx_command_t`: Definition of each configuration directive (name, argument rules, set function, offset)
   - `ngx_conf_t`: Parse context

2. **`src/core/ngx_conf_file.c`**
   - **`ngx_conf_parse()`** — Recursive parse entry point; calls itself recursively for block directives
   - `ngx_conf_handler()` — Dispatches to a module's set function

3. **Argument type flags quick reference**:
   ```
   NGX_CONF_NOARGS         -- No arguments (e.g., "off" in "accept_mutex off;" is a flag, not an argument)
   NGX_CONF_TAKE1~7        -- Exactly N arguments
   NGX_CONF_TAKE12         -- 1 or 2 arguments
   NGX_CONF_FLAG           -- Boolean (on/off)
   NGX_CONF_BLOCK          -- Followed by a {} block
   NGX_CONF_1MORE          -- At least 1 argument
   ```

4. **Setter function family**: `ngx_conf_set_flag_slot`, `ngx_conf_set_str_slot`, `ngx_conf_set_num_slot`, `ngx_conf_set_size_slot`, `ngx_conf_set_msec_slot`, etc. — the basic building blocks of configuration parsing.

5. **Configuration merge macros**:
   ```c
   ngx_conf_merge_value(conf, prev, default)   // Numeric: current → parent → default
   ngx_conf_merge_str_value(conf, prev, default)
   ngx_conf_merge_msec_value(conf, prev, default)
   ```
   These embody nginx's three-level fallback mechanism for configuration inheritance.

### Step 5: Module System (1-2 hours)

1. **`src/core/ngx_module.h`** — The `ngx_module_t` struct
   - Global index `index` and type-specific index `ctx_index`
   - Type-specific `ctx` pointer
   - `commands` array (configuration directive definitions)
   - Lifecycle hooks: `init_master` → `init_module` → `init_process` → `exit_process` → `exit_master`

2. **Module types**:
   ```
   NGX_CORE_MODULE    -- Core modules (e.g., ngx_core_module, ngx_events_module, ngx_http_module)
   NGX_EVENT_MODULE   -- Event modules (e.g., ngx_epoll_module, ngx_kqueue_module)
   NGX_HTTP_MODULE    -- HTTP modules
   NGX_MAIL_MODULE    -- Mail modules
   NGX_STREAM_MODULE  -- Stream modules
   ```

3. **`src/core/ngx_module.c`**
   - `ngx_cycle_modules()` — Copy the module array into the cycle
   - `ngx_init_modules()` — Call each module's `init_module`

4. **HTTP module-specific context** `ngx_http_module_t`:
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
   **This is key to understanding how HTTP modules work**: the creation and merging of main → srv → loc three-level configurations all happen here.

### Step 6: HTTP Request Processing Pipeline (4-5 hours) ⭐ Core

This is the most important and complex part of the nginx source code — read it repeatedly.

#### 6.1 HTTP Framework Initialization

**`src/http/ngx_http.c`**
- `ngx_http_block()` — The parse function for the `http {}` block
  - Creates main/srv/loc three-level configurations
  - Initializes the phase engine
  - Calls each module's `postconfiguration` (handlers and filters are registered here)
  - Initializes request header parsing tables and the variable system

#### 6.2 The 11 Processing Phases

**`src/http/ngx_http_core_module.h`**

```
NGX_HTTP_POST_READ_PHASE       -- After reading request headers (realip module lives here)
NGX_HTTP_SERVER_REWRITE_PHASE  -- Server-level rewrite
NGX_HTTP_FIND_CONFIG_PHASE     -- Location matching
NGX_HTTP_REWRITE_PHASE         -- Location-level rewrite
NGX_HTTP_POST_REWRITE_PHASE    -- After rewrite (checks for redirect loops)
NGX_HTTP_PREACCESS_PHASE       -- Access limits (limit_conn, limit_req)
NGX_HTTP_ACCESS_PHASE          -- Authorization checks (allow/deny, auth_basic, auth_request)
NGX_HTTP_POST_ACCESS_PHASE     -- After access (handles satisfy all/any)
NGX_HTTP_PRECONTENT_PHASE      -- Before content generation (mirror, try_files)
NGX_HTTP_CONTENT_PHASE         -- Generate response content (proxy_pass, fastcgi_pass, static)
NGX_HTTP_LOG_PHASE             -- Logging (after request processing is complete)
```

Each phase is driven by a **checker function** that sequentially invokes the handlers registered for that phase. Key checkers:

| Checker | Phase | Behavior |
|---------|------|------|
| `ngx_http_core_generic_phase` | rewrite, etc. | Sequential execution, DECLINED → next handler |
| `ngx_http_core_find_config_phase` | find_config | Match location, executes only once |
| `ngx_http_core_access_phase` | access | Supports satisfy all/any |
| `ngx_http_core_content_phase` | content | Finds the first handler that returns OK |

Reading entry point: **`ngx_http_core_run_phases()`**

#### 6.3 Request Lifecycle

**`src/http/ngx_http_request.h`** — `ngx_http_request_t` struct (very large, ~60+ fields)

**`src/http/ngx_http_request.c`** — Read the following functions in order:

```
New connection arrives:
  ngx_http_init_connection()
    → ngx_http_wait_request_handler()      -- Wait for the complete request header to arrive

Request header parsed:
  ngx_http_process_request_line()
    → ngx_http_process_request_headers()
      → ngx_http_process_request()
        → ngx_http_process_request_headers()  -- Parse Host, Content-Length, etc.
        → ngx_http_handler()                  -- Set r->phase_handler = 0
          → ngx_http_core_run_phases(r)       -- Drive the phase engine

Response sending:
  ngx_http_writer()                         -- Asynchronously send the response body

Request finished:
  ngx_http_finalize_request()
    → ngx_http_free_request()
      → ngx_destroy_pool(r->pool)          -- Destroy the request memory pool
```

#### 6.4 Filter Chain

nginx output is not produced by a single module in one shot — it is collaboratively generated through a **filter chain** (Chain of Responsibility pattern).

**Header filter chain**:
```
ngx_http_top_header_filter
  → ngx_http_not_modified_header_filter
  → ...
  → ngx_http_gzip_header_filter
  → ...
  → ngx_http_header_filter          -- Ultimately serializes HTTP headers into a byte stream
```

**Body filter chain**:
```
ngx_http_top_body_filter
  → ngx_http_range_body_filter
  → ngx_http_copy_filter            -- Copies in_file bufs to memory when necessary
  → ngx_http_gzip_body_filter
  → ngx_http_chunked_body_filter
  → ngx_http_write_filter           -- Ultimately calls c->send_chain() to send
```

Filter registration pattern:
```c
// Register in postconfiguration:
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
Note: **the last registered executes first** (because each is inserted at the head of the chain).

#### 6.5 Location Matching

**`src/http/ngx_http_core_module.c`**

The matching algorithm in `ngx_http_core_find_config_phase()`:
1. Use `ngx_hash_lookup()` on the `locations` hash table for **prefix matching**
2. If the matched location has nested locations, search recursively
3. Finally, use the `regex_locations` queue for **regex matching** (highest priority, using `=~` or `~*`)

**Configuration merge path**: after matching a location, its `loc_conf[module_index]` has already correctly inherited from server and main level configurations via `merge_loc_conf` during the parsing phase.

#### 6.6 Upstream Mechanism

**`src/http/ngx_http_upstream.h`** + **`src/http/ngx_http_upstream.c`**

The upstream state machine:
```
ngx_http_upstream_init()
  → ngx_http_upstream_connect()           -- Establish connection to backend
    → ngx_http_upstream_send_request()    -- Send request body
      → ngx_http_upstream_process_header()  -- Parse response header
        → ngx_http_upstream_process_body_in_memory() or sendfile/pipe -- Forward response body
          → ngx_http_upstream_finalize_request()
```

Load balancing is **pluggable** via the `ngx_http_upstream_peer_t` interface:
- `ngx_http_upstream_round_robin.c` — Weighted round-robin (default)
- `ngx_http_upstream_hash_module.c` — Consistent hashing
- `ngx_http_upstream_least_conn_module.c` — Least connections
- `ngx_http_upstream_random_module.c` — Random selection

### Step 7: Supplementary Reading (as needed)

1. **Logging System**: `src/core/ngx_log.h` + `ngx_log.c` — `ngx_log_t` leveled logging, chained log objects
2. **Variable System**: `src/http/ngx_http_variables.c` — How variables like `$remote_addr`, `$host` are registered and evaluated
3. **Regex Engine**: `src/core/ngx_regex.c` — Wrapper around PCRE (nginx does not implement its own regex engine)
4. **Shared Memory & Slab Allocator**: `src/core/ngx_slab.c` — Slab allocator for multi-process shared data
5. **SSL/TLS**: `src/event/ngx_event_openssl.c` — How SSL is implemented by swapping `c->recv/send` function pointers
6. **HTTP/2**: `src/http/v2/` — HTTP/2 frame parsing and multiplexing
7. **QUIC/HTTP/3**: `src/event/quic/` + `src/http/v3/` — QUIC transport layer and HTTP/3 implementation

---

## 3. Design Patterns and Mindset Throughout

### 3.1 Intrusive Data Structures

nginx does not separately allocate list nodes or tree nodes. Instead, `ngx_queue_t` and `ngx_rbtree_node_t` are **directly embedded** in the structs that use them. Zero extra allocation, extreme efficiency.

```c
// Not: list<Item*> items (malloc a node for every insertion)
// Instead: Item contains ngx_queue_t queue, linked in directly
```

### 3.2 Pre-allocation + Reuse

Connections, events, memory pools — all pre-allocated at startup, no `malloc` at runtime. nginx's philosophy: **"Whatever maximum resources I can calculate at startup, I pre-allocate."**

### 3.3 I/O Function Pointer Polymorphism

```c
c->recv = ngx_ssl_recv;   // SSL module silently swaps these
c->send = ngx_ssl_send;
```
Higher-level code (the HTTP framework) is completely unaware whether the underlying transport is TCP, SSL, or QUIC. This is nginx's key technique for protocol upgrades and SSL transparency.

### 3.4 Return-Value-Driven Control Flow

nginx does not use exceptions or `goto`. Instead, control intent is expressed through return values:

| Return Value | Semantics |
|-------|------|
| `NGX_OK` | Done, caller continues |
| `NGX_ERROR` | Error, abort |
| `NGX_AGAIN` | Insufficient resources (buffer full, data not arrived yet), pause and wait for the next event trigger |
| `NGX_DECLINED` | I won't handle this, try the next one (core of handler singly-linked list traversal) |
| `NGX_DONE` | Handled, but the request is not finished (async operation pending) |
| `NGX_BUSY` | Busy, retry later |

Understanding the difference between `NGX_AGAIN` and `NGX_DECLINED` is particularly important — the former means "wait a bit and I'll retry", the latter means "move on to the next one."

### 3.5 Graceful Zero-Downtime

The core logic of configuration reload (`nginx -s reload`):

1. Master receives `SIGHUP` → creates a new `ngx_cycle_t`, forks new workers
2. Old workers receive `SIGQUIT` → graceful shutdown (finish existing connections before exiting)
3. Old and new workers briefly coexist; once old workers exit, the new cycle takes over

This relies on the `cycle->old_cycle` design: the new cycle holds a reference to the old cycle, releasing it after old workers exit.

---

## 4. Debugging Tips

### 4.1 Debug Logging

Build with `--with-debug`, then set in the configuration:
```nginx
error_log /var/log/nginx/debug.log debug;
```

### 4.2 Common GDB Breakpoints

```gdb
# Event loop entry
b ngx_process_events_and_timers

# Request processing entry
b ngx_http_process_request

# Phase engine
b ngx_http_core_run_phases

# Connection allocation
b ngx_get_connection

# Upstream connection
b ngx_http_upstream_connect

# All recv/send calls on a connection
b ngx_unix_recv
b ngx_unix_send
```

### 4.3 Printing ngx_str_t

```gdb
# ngx_str_t is not a C string — needs custom printing in GDB
define print_ngx_str
  set $s = (ngx_str_t*)$arg0
  printf "%.*s\n", $s->len, $s->data
end
```

### 4.4 Tracing Memory Allocation

Set breakpoints at key functions in `src/core/ngx_palloc.c`:
- `ngx_create_pool` — Pool creation
- `ngx_palloc` — Small block allocation
- `ngx_palloc_block` — Allocate new pool block
- `ngx_pfree` — Large block free
- `ngx_destroy_pool` — Pool destruction

---

## 5. Recommended Reading Practices

1. **Don't try to read sequentially by file number**. nginx has many static functions and global variables. Read by header file dependency relationships.
2. **Trace one functional path at a time**. For example, "the complete path of an HTTP GET request from reception to response" — only focus on functions on this path, ignore side branches.
3. **Draw diagrams**. Struct nesting in nginx source code is very deep. Hand-drawing the following relationship diagrams will be very helpful:
   - `ngx_cycle_t` → `conf_ctx` → indexing relationships of each module's configuration
   - `ngx_connection_t` → `read` / `write` → `ngx_event_t` → `handler` call chain
   - The checker → handler → next jump relationships in the HTTP phase engine
   - The `ngx_http_top_header_filter` → `next` → ... order in the filter chain
4. **Start from simple third-party modules**. Read simple modules at the level of `src/http/modules/ngx_http_echo_module.c` to understand how handlers and filters are written.
5. **Comparative reading**. Find two modules with similar functionality under `src/http/modules/` (e.g., proxy vs fastcgi) and understand where they differ.
6. **Re-read core functions**. `ngx_process_events_and_timers()`, `ngx_http_core_run_phases()`, `ngx_conf_parse()`, `ngx_http_upstream_connect()` — these functions are worth reading repeatedly; you'll discover new details each time.

---

## 6. Core File Index

| File | Priority | Core Content |
|------|:---:|---------|
| `src/core/nginx.c` | ★★★ | `main()` entry point |
| `src/core/ngx_cycle.c` | ★★★ | `ngx_init_cycle()` cycle initialization |
| `src/core/ngx_palloc.c` | ★★★ | Memory pool implementation |
| `src/core/ngx_buf.c` | ★★★ | Buffer and chain operations |
| `src/core/ngx_connection.c` | ★★★ | Connection pre-allocation and management |
| `src/core/ngx_conf_file.c` | ★★★ | Configuration parser |
| `src/core/ngx_module.c` | ★★★ | Module loading and initialization |
| `src/core/ngx_string.c` | ★★☆ | String utility function collection |
| `src/core/ngx_array.h` | ★★★ | Dynamic array |
| `src/core/ngx_list.h` | ★★★ | Linked list + array hybrid |
| `src/core/ngx_queue.h` | ★★★ | Intrusive doubly-linked list |
| `src/core/ngx_rbtree.c` | ★★☆ | Red-black tree |
| `src/core/ngx_hash.c` | ★★☆ | Static hash table |
| `src/core/ngx_log.c` | ★★☆ | Logging system |
| `src/os/unix/ngx_process_cycle.c` | ★★★ | Master/worker process management |
| `src/event/ngx_event.c` | ★★★ | Event loop core |
| `src/event/ngx_event_accept.c` | ★★☆ | Accept and thundering herd handling |
| `src/event/ngx_event_timer.h` | ★★☆ | Timer management |
| `src/event/modules/ngx_epoll_module.c` | ★★☆ | epoll event module |
| `src/http/ngx_http.c` | ★★★ | HTTP framework initialization |
| `src/http/ngx_http_request.c` | ★★★ | Request lifecycle |
| `src/http/ngx_http_core_module.c` | ★★★ | Core directives, phase checkers |
| `src/http/ngx_http_upstream.c` | ★★★ | Upstream proxy mechanism |
| `src/http/ngx_http_variables.c` | ★★☆ | Variable system |
| `src/http/ngx_http_header_filter.c` | ★★☆ | Response header serialization |
| `src/http/ngx_http_write_filter.c` | ★★☆ | Final send to socket |
| `src/http/modules/ngx_http_proxy_module.c` | ★★☆ | Typical HTTP proxy module |
| `src/http/modules/ngx_http_static_module.c` | ★☆☆ | Simplest content handler |

---

> **Final advice**: Reading the nginx source code is a marathon, not a sprint. The core code is about 100K lines, but the design is highly consistent. Once you master the patterns in the first 30%, the remaining 70% will go much faster. Happy reading!
