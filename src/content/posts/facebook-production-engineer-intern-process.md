---
title: "Facebook: Production Engineer Internship Process"
description: "Interviewing for the Production Engineer Intern role at Facebook London — the three rounds, what they test, and the resources that help."
date: 2019-11-03
---

> *Archived from my old blog (2019). The process and links reflect that era —
> treat the specifics as historical, the preparation advice still holds up.*

Recently, I had interviews with Facebook regarding the Production Engineer
Intern role at the London office. Though I got rejection after the second
interview, it was an experience worth sharing.

## What is Production Engineering@Facebook?

> *Production Engineering at Facebook is a hybrid between software and systems
> engineering; it keeps Facebook running smoothly and scaling efficiently. The
> Production Engineering team works within Facebook's product and
> infrastructure teams to make sure their services are reliable and scalable.*

![Facebook's London office](/images/fb-london-office.jpeg)

## The Process…

This process is a lot different from that of a Software Engineer Internship.
They don't judge you on how well you can retain algorithms in your mind or how
many types of coding problems you can solve. It's mostly about how well can
you use your knowledge in a practical scenario.

The process is divided into three phases:

1. MCQs on Linux Internals
2. Coding Interview
3. Systems Interview

### MCQs on Linux Internals

This round consists of 20 MCQ questions which are quite straightforward. The
questions are based on basic Linux commands (like grep, find, mount, etc.),
file permissions, environment variables, process handling (signals), etc.

### Coding Interview

This round is quite different from that of other programming interviews you
might have taken or heard of before. They won't ask you complex algorithmic
questions. The questions are designed to check your understanding of basic
algorithms and data structures. It will also focus on how well you can use
your skills to solve sophisticated problems involving string manipulation,
File I/O, threads, pipes, memory or other systems related stuff.

Tips: You must take care of the system's limitations while solving the
questions. E.g. While working on a problem related to File I/O, you must also
consider the case where the files might be too large to fit in system memory.

Some resources that might be of help:

1. [Facebook Engineering: Crush Your Coding Interview](https://www.facebook.com/video.php?v=10152735777427200)
2. [The HackerRank Interview Preparation Kit](https://www.hackerrank.com/interview/interview-preparation-kit)
3. [LeetCode](https://leetcode.com/)
4. [CareerCup](http://www.careercup.com/page)
5. LintCode

Examples of some previously asked questions:

1. Read from an API call that gives structured data in JSON and arrange that data in the requested format.
2. RegEx: Eliminate email addresses from the given HTML file.
3. File I/O (multiple files): [Facebook Production Engineer Interview question](https://www.glassdoor.co.in/Interview/You-will-be-supplied-with-two-data-files-in-CSV-format-The-first-file-contains-statistics-about-various-dinosaurs-The-se-QTN_2088069.htm)

### Systems Interview

I found this round of interview very challenging, yet the most intriguing.
This round is designed to check your familiarity with the various sub-systems
in Linux and their workings. Generally, two different categories of questions
can be framed for this round of interview.

#### Internals (Theory)

Believe me, when I say, you must be thorough enough with the internals to be
able to build a simple prototype if asked. Though they would never ask you to
build it, questions would be enough to judge your knowledge.

The discussion would start at a reasonably high level, but they would go
deeper until you break and surrender.

*Essential books to consider (if you are into books):*

1. Linux Kernel Development: Robert Love — This book has some good explanations of how various features are implemented, at the lowest levels, inside Linux.
2. Advanced Programming in the UNIX Environment: W. Richard Stevens — Use this as a reference for understanding various topics.

*Important links:*

1. [jvns.ca](https://jvns.ca/): There is a lot of excellent content on this blog!
2. [Linux Inside](https://0xax.gitbooks.io/linux-insides/content/): This has pretty good explanations of various sub-systems.
3. [The Bits and Bytes of Computer Networking](https://www.coursera.org/learn/computer-networking?specialization=google-it-support): I feel that this course is more or less enough for the networking part!
4. [How the web works: HTTP and CGI explained](http://www.garshol.priv.no/download/text/http-tut.html)
5. [Linux Boot Process — Part 1](https://medium.com/@cloudchef/linux-boot-process-part-1-e8fea015dd66)
6. [Linux Boot Process — Part 2](https://medium.com/@cloudchef/linux-boot-process-part-2-bd7514913495)
7. [What happens when…](https://github.com/alex/what-happens-when)

There are many blogs out there which can familiarize you with various Linux
internals, use Google!

#### Troubleshooting

Here, you would be given a practical systems issue, and you would be asked to
troubleshoot errors.

E.g. A user is trying to communicate with a server over port 80
(port 80 → HTTP) through a browser, but he is not able to establish the
connection, what might be the problem?

There can be lots of reasons for such an incident, like network issues,
firewall blocked ports, bad gateway config, bad DNS config, etc. After
figuring out various possible causes, you can start to eliminate some using
Linux tools like ping, nmap, nslookup, etc.

There won't be the right solution for these types of questions, but a
"better" solution!

*Important links:*

1. [Netflix at Velocity — 2015](http://techblog.netflix.com/2015/08/netflix-at-velocity-2015-linux.html)
2. [Linux Performance Analysis in 60,000 Milliseconds](https://medium.com/netflix-techblog/linux-performance-analysis-in-60-000-milliseconds-accc10403c55)
3. [Linux Troubleshooting: High Load](https://www.linuxjournal.com/article/10688)
4. [Linux Troubleshooting: Local Network](https://www.linuxjournal.com/article/10712)
5. [Linux Troubleshooting: Remote Networks](https://www.linuxjournal.com/article/10738)
6. [Hunting the Performance Wumpus](http://web.archive.org/web/20101028025942/https://anchor.com.au/hosting/development/HuntingThePerformanceWumpus)
7. [Performance Tuning](https://cromwell-intl.com/open-source/performance-tuning/)

For practice, you might want to work on some projects. It would help you in
understanding things better! Some of the projects you can work on:

1. You can start with implementing some essential Linux utilities like grep, cat, zip/unzip in C
2. [Code your own UNIX-like shell](https://github.com/remzi-arpacidusseau/ostep-projects/tree/master/processes-shell): this would be of great help!

If interested, more projects can be found in
[ostep-projects](https://github.com/remzi-arpacidusseau/ostep-projects).

A few more miscellaneous resources:

- [Netflix Tech Blog](http://techblog.netflix.com/)
- [HardForum](http://hardforum.com/)
- [Ubuntu Server Guide](https://help.ubuntu.com/lts/serverguide/index.html)
- [Ask Ubuntu](http://askubuntu.com/)
- [Unix & Linux Stack Exchange](http://unix.stackexchange.com/)
- [Kernel Newbies](http://kernelnewbies.org/)
- [Learn Linux Concepts](https://learnlinuxconcepts.blogspot.com/)
