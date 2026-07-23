---
layout: post
title: "Problem 177: Nth Highest Salary"
date: 2021-02-23 08:05:02 +0800
categories: LeetCode-DataBase
tags: database
lang: en
ref: nth-highest-salary
permalink: /en/2021-02-23/nth-highest-salary.html
summary: "LeetCode 177. Nth Highest Salary - MySQL custom function solution"
---

## [177. Nth Highest Salary](https://leetcode.com/problems/nth-highest-salary/)

Write a SQL query to get the nth highest salary from the Employee table.

| Id | Salary |
|----|--------|
| 1  | 100    |
| 2  | 200    |
| 3  | 300    |

For example, given the above Employee table, the nth highest salary where n = 2 is 200. If there is no nth highest salary, the query should return null.

| getNthHighestSalary(2) |
|------------------------|
| 200                    |

SQL script:

```sql
Create table If Not Exists Employee (Id int, Salary int);
Truncate table Employee;
insert into Employee (Id, Salary) values (1, 100);
insert into Employee (Id, Salary) values (2, 200);
insert into Employee (Id, Salary) values (3, 300);
```

## Solution

Solution 1:

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

If you encounter errors running this directly in MySQL, refer to: [DETERMINISTIC, NO SQL, or READS SQL DATA in its declaration and binary logging is enabled](https://stackoverflow.com/questions/26015160/deterministic-no-sql-or-reads-sql-data-in-its-declaration-and-binary-logging-i)
