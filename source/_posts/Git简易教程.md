---
title: Git简易教程
date: 2021-02-21 21:51:18
tags: Git
categories: Git教程
cover: git-logo.png
---

> 将暂存区中文件恢复为和HEAD一样

`git reset HEAD` 将暂存区中所有文件恢复为和HEAD一样

`git reset HEAD -- [filename]`将暂存区中名字为filename的文件恢复为和HEAD一样

> 比较暂存区和HEAD所含文件差异

`git diff --cached`

> 比较工作区和暂存区所含文件差异

`git diff`默认比较暂存区和工作区的文件的区别

`git diff -- [filename]` 比较工作区和暂存区中名字为filename的文件的内容的区别

> 将工作区中文件内容恢复为和暂存区中一样

`git checkout -- [filename]`将工作区中的名字为filename的文件恢复为和暂存区中一样

> 将暂存区和工作区的内容恢复至某次commit

`git reset --hard  [commit code]`将工作区和暂存区中的内容恢复至与某次commit一样【慎用】

> 查看不同commit的指定文件的差异

`git diff [commit code 1] [commit code 2] -- [filename] `

> 删除暂存区和工作区指定文件

`git rm [filename]` 

> 将变更进行存入临时栈空间

`git stash`将变更存入栈空间

`git stash apply`栈空间中的内容仍存在

`git stash pop`栈空间中的内容被移除

> git仓库备份

`git clone --bare [remote git repository] [local git repository]` 哑协议方式

`git clone --bare [file:///<remote git repository>] [local git repository]`智能协议方式

`git remote add [remote repository name] [file:///<remote git repository>]`

`git push --set-upstream [remote repository name] [branch name]`将本地分支推送至远程仓库

`git push [remote repository name] [branch name] `  将本地分支推送至远程仓库