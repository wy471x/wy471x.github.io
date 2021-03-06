---
title: 'Problem 177:第N高的薪水'
date: 2021-02-23 08:05:02
tags: 数据库
categories: LeetCode DataBase
cover: Problem 177.jpg
---
## [177. 第N高的薪水](https://leetcode-cn.com/problems/nth-highest-salary/)
编写一个 SQL 查询，获取 Employee 表中第 n 高的薪水（Salary）。


| Id   | Salary |
| - | - |
| 1    | 100    |
| 2    | 200    |
| 3    | 300    |


例如上述 Employee 表，n = 2 时，应返回第二高的薪水 200。如果不存在第 n 高的薪水，那么查询应返回 null。


| getNthHighestSalary(2) |
| ---------------------- |
| 200                    |



sql脚本：

```sql
Create table If Not Exists Employee (Id int, Salary int);
Truncate table Employee;
insert into Employee (Id, Salary) values (1, 100);
insert into Employee (Id, Salary) values (2, 200);
insert into Employee (Id, Salary) values (3, 300);
```
## 解答
解法一：
```sql
CREATE FUNCTION getNthHighestSalary(N INT) RETURNS INT
BEGIN
		SET N := N - 1;
  RETURN (
      # Write your MySQL query statement below.
      SELECT (SELECT DISTINCT Salary FROM Employee ORDER BY Salary DESC LIMIT N, 1)
  );
END
```

MySQL直接执行会遇到报错信息，解决方案请参考：[DETERMINISTIC, NO SQL, or READS SQL DATA in its declaration and binary logging is enabled](https://stackoverflow.com/questions/26015160/deterministic-no-sql-or-reads-sql-data-in-its-declaration-and-binary-logging-i)