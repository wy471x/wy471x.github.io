---
layout: post
title: "Git Tutorial"
date: 2021-02-21 21:51:18 +0800
categories: Git-Tutorial
tags: Git
lang: en
ref: git-tutorial
permalink: /en/2021-02-21/git-tutorial.html
summary: "Git command quick reference - including reset, diff, checkout, stash and more"
---

> Restore files in staging area to match HEAD

`git reset HEAD` restores all files in staging area to match HEAD

`git reset HEAD -- [filename]` restores the specified file in staging area to match HEAD

> Compare differences between staging area and HEAD

`git diff --cached`

> Compare differences between working directory and staging area

`git diff` compares differences between staging area and working directory

`git diff -- [filename]` compares differences for the specified file

> Restore working directory files to match staging area

`git checkout -- [filename]` restores the specified file in working directory to match staging area

> Restore both staging area and working directory to a specific commit

`git reset --hard [commit code]` restores both staging area and working directory to match a specific commit [use with caution]

> Compare differences for a specified file between different commits

`git diff [commit code 1] [commit code 2] -- [filename]`

> Remove a file from both staging area and working directory

`git rm [filename]`

> Stash changes to a temporary stack

`git stash` saves changes to the stack

`git stash apply` applies changes while keeping them in the stack

`git stash pop` applies changes and removes them from the stack

> Git repository backup

`git clone --bare [remote git repository] [local git repository]` using dumb protocol

`git clone --bare [file:///<remote git repository>] [local git repository]` using smart protocol

`git remote add [remote repository name] [file:///<remote git repository>]`

`git push --set-upstream [remote repository name] [branch name]` push local branch to remote repository

`git push [remote repository name] [branch name]` push local branch to remote repository
