---
layout: post
title: "Problem 175: Combine Two Tables"
date: 2021-02-17 22:02:22 +0800
categories: LeetCode-Database
tags: database
lang: en
ref: combine-two-tables
permalink: /en/2021-02-17/problem-175-combine-two-tables.html
summary: "LeetCode 175. Combine Two Tables - LEFT JOIN solution"
---

## [175. Combine Two Tables](https://leetcode.com/problems/combine-two-tables/)

Table 1: Person

| Column Name | Type    |
|-------------|---------|
| PersonId    | int     |
| FirstName   | varchar |
| LastName    | varchar |

> `PersonId` is the primary key for this table.

Table 2: Address

| Column Name | Type    |
|-------------|---------|
| AddressId   | int     |
| PersonId    | int     |
| City        | varchar |
| State       | varchar |

> `AddressId` is the primary key for this table.

Write a SQL query that provides the following information for each person in the Person table, regardless of whether there is an address entry for that person:

FirstName, LastName, City, State

SQL script:

```sql
Create table Person (PersonId int, FirstName varchar(255), LastName varchar(255));
Create table Address (AddressId int, PersonId int, City varchar(255), State varchar(255));
Truncate table Person;
insert into Person (PersonId, LastName, FirstName) values ('1', 'Wang', 'Allen');
Truncate table Address;
insert into Address (AddressId, PersonId, City, State) values ('1', '2', 'New York City', 'New York');
```

## Solution

Solution 1: LEFT JOIN

```sql
SELECT
    FirstName,
    LastName,
    City,
    State
FROM
    Person
    LEFT JOIN
    Address ON (Person.PersonId = Address.PersonId);
```
