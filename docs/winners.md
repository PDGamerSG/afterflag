# What previous WeMakeDevs winners demonstrated

Public award records identify solo entrants and teams of up to four. They show much more about the work that judges rewarded than about entrants’ backgrounds. Insidious lets judges see the effect of a real Flagsmith change during a load test. DebugProof uses the same fault to compare two releases and gives CI a concrete reason to block. Afterflag applies that comparison to a V2-only worker before and after draining the retained V1 job. [Festive Hacks second place](https://x.com/WeMakeDevs/status/2126001571184116029) · [Agents of SigNoz results](https://archive.wemakedevs.org/hackathons/signoz/projects) · [Toggle Wars judging guide](https://www.wemakedevs.org/blogs/how-to-win-toggle-wars)

The review checked organizer results and linked project artifacts on November 27, 2026. The tables cover 30 project records across seven events. Measurements are attributed to the projects that reported them.

## Festive Hacks

The event used a three-prize structure with a specific Flagsmith award. Two organizer announcements were retrievable. The gallery lists 62 projects without ranks. A search of the organizer’s public posts and 55 accessible project READMEs left the first-place recipient unresolved. [Prize rules](https://www.wemakedevs.org/hackathons/festivehacks#prizes) · [Project gallery](https://www.wemakedevs.org/hackathons/festivehacks/projects)

| Award | Project and public credits | Demonstrated mechanism | Evidence |
| --- | --- | --- | --- |
| Second place, Best Use of Flagsmith | Insidious · Aloys Jehwin | An approved WhatsApp operations command changes live Flagsmith load shedding and database pool settings. Its controlled test reported checkout p95 dropping from 4.8 s to 180 ms at 80 requests/s with load shedding. | [Announcement](https://x.com/WeMakeDevs/status/2126001571184116029) · [Repository](https://github.com/AloysJehwin/insidious) |
| Third place | RaktSetu · Abhinav Maharana and Shivam Umang Mitter | A voice-first blood finder verifies leads with approved calls. Flagsmith controls call mode and supplies a kill switch. | [Announcement](https://x.com/WeMakeDevs/status/2125980543393394842) · [Repository](https://github.com/mavihsrr/raktsetu) |

## Cloud Native Hackathon

The organizer published six named awards. [Official results](https://www.wemakedevs.org/hackathons/cnh/projects)

| Award | Project and public credits | Demonstrated mechanism | Evidence |
| --- | --- | --- | --- |
| DGX Spark | Roloe · Weston Bell-Geddes | Coding agents exchange findings between conference contacts with privacy controls. A trace-guided change reduced Elasticsearch calls per meeting from 25 to 7. | [Repository](https://github.com/WestonBDev/roloe) |
| Gitar | Pulse · Tyler Jerman and Owen Bodily | Repository-specific review rules catch and explain authorization and deployment issues. | [Repository](https://github.com/owenbodily-osbmach1/HACKATHONproject-T-O) |
| Dash0 | CapyKube · Nelson Lai | Recommends alternative talks and shows the current latency target. Dash0 traces guided search improvements. | [Repository](https://github.com/chinesepowered/hack-slc) |
| Radar | ConQuest · Jacob Bingham, Max Parry, Jake Nef and Daniel Nef | The team used Radar to diagnose deployment errors and resolve cluster findings in a conference game. | [Repository](https://github.com/Ronjhon10/conquest) |
| Elasticsearch | Nautilus · Skyler Smith and Tanner Nielson | Looks up unfamiliar talk phrases in an Elasticsearch glossary as the talk happens. | [Repository](https://github.com/zackhada/confpilot) |
| Merge Forward | Grace Period · JAI Fuller | Gives conference attendees quick access to a quiet room and communication cards they can show staff. | [Repository](https://github.com/zofrus/vaiking) |

## Agents of SigNoz

The archived result identifies all three track winners and a separate pre-event blog award for Pooja Bhavani’s self-hosted Claude observability walkthrough. [Official results](https://archive.wemakedevs.org/hackathons/signoz/projects)

| Award | Project and public credits | Demonstrated mechanism | Evidence |
| --- | --- | --- | --- |
| Track 01 | OpenTelemetry Instruments for CrewAI · Srinjoy Roy | Instruments agent handoffs, verifies real OTLP ingestion in self-hosted SigNoz and triggers an alert. | [Repository](https://github.com/srinjoy356/opentelemetry-instrumentation-crewai) |
| Track 02 | DebugProof · Dhruv Sachdev | Runs the same fault against two versions and blocks a candidate that loses the failing span or its correlated log. | [Repository](https://github.com/Dhruv-Sachdev1313/debugproof) |
| Track 03 | RootCause · Shashwat Pratap Singh | Represents hydroponic dosing cycles as traces and correlates metrics, logs and alerts across injected failures. | [Repository](https://github.com/Shrinet82/rootcause-hydro) |

## AWS First Commit

The results name three podium projects and four credit-awarded runners-up. Some deployment and demo links failed retrieval. The Factcade repository returned 404, and its available deployment uses built-in sample data. [Official project results](https://www.wemakedevs.org/aws/first-commit/projects) · [Separate blog awards](https://www.wemakedevs.org/aws/first-commit/projects/blogs) · [Factcade deployment](https://main.duvf6xc7vuvld.amplifyapp.com/)

| Award | Project and public credits | Demonstrated mechanism | Evidence |
| --- | --- | --- | --- |
| First prize, Ship It | Suraksha · StarBugs, Naomi Pereira, Harshendra M and Shashwath Prabhu | A watch and voice assistant detect concerning changes, check in and escalate to family under Cedar consent rules. | [Repository](https://github.com/harshendram/firstcommit-hack) |
| Second prize, Build It | Beacon Night Shift · CoffeAndCode, Prashant Thakur | Correlates CloudWatch and CloudTrail, then dry-runs and verifies an approved repair. | [Judged submission](https://github.com/Prashant-thakur77/Beacon/tree/first-commit-submission) |
| Third prize, Best UI | CampusEvac · 3 BUILDS, Abhishek M. Shivanagoudar, Afreen Hossain and Akshay R | Synchronizes an evacuee and warden in a browser fire drill. | [Repository](https://github.com/AfreenInnovates/campus) |
| Runner-up | Magpie · VOXTON, Akshay Nazare, Kamran Pathan, Sanskar Joshi and Anushka Salvi | Pairs a persistent finance grid with deterministic reconciliation and a queue for unmatched records. | [Repository](https://github.com/akkki007/magpie) |
| Runner-up | FreshTrace · Powerpuff Girls, Sai Koushik Pallapolu, shiva sai, Rakshit Chaturvedi and Veerabhadra Yerram | Streams environmental readings from an ESP32 to AWS to predict spoilage and remaining shelf life. | [Repository](https://github.com/RakshitChaturvedi/FreshTrace) |
| Runner-up | Expressive captions · Need sleep, Shubh Gupta, Krish Jain and Divya Anand | Aligns Hinglish captions with AWS word timings and uses speech emphasis to style them. | [Repository](https://github.com/sept1st2c/Daks-caption_VoiceAgent-video-editing) |
| Runner-up | Factcade · Mohammed Ali Khan | Models the downstream effects of failing equipment. Amazon Nova proposes a recovery plan for operator approval. | [Submission demo](https://youtu.be/dzFcAaL3DCM) |

## Cognee Hackathon

The organizer lists two grand project winners and a blog winner. RealtyRecall’s repository now redirects to Super Realty. The Classroom Memory deployment health check timed out. [Official project and blog awards](https://archive.wemakedevs.org/hackathons/cognee/projects) · [Separate PR awards](https://archive.wemakedevs.org/hackathons/cognee/projects/prs)

| Award | Project and public credits | Demonstrated mechanism | Evidence |
| --- | --- | --- | --- |
| Best Use of Cognee Open Source | Lethe · Vinayak Sonthalia | Uses a graph and vector index for cited incident guidance, then re-queries after deleting retired-system records. | [Repository](https://github.com/vinayaksonthalia/lethe) |
| Best Use of Cognee Cloud | Classroom Memory · Rajdeep Singh | Combines student memories and adaptive quiz results with a prerequisite graph to rank topics to teach next. | [Repository](https://github.com/RajdeepKushwaha5/ClassroomMemory) |
| Best Blog | RealtyRecall · Mahimai Raja J | Uses caller identity and a lead/listing graph to resume conversations, recommend properties and book showings. | [Renamed repository](https://github.com/mahimairaja/superrealty) |

## Graph Hacks

The published outcomes include three project tracks and a blog award. KT Brain’s repository returned 404. The organizer’s project description and video provide its available evidence. [Official results](https://www.wemakedevs.org/hackathons/falkordb/projects)

| Award | Project and public credits | Demonstrated mechanism | Evidence |
| --- | --- | --- | --- |
| Agents That Act on Connected Data | Precedent Graph · Arnab Saha | Traverses treatment-labeled citations, checking chronology and bench strength to show why a ruling is still good law. | [Repository](https://github.com/AnonyPotamus/precedent-graph) |
| Agent Memory and Coordination | Pathaway · Aymaan-Pathan | Uses GitHub history to map demonstrated skills in FalkorDB and checks a suggested exercise with a diff and tests. | [Repository, branded Pathway](https://github.com/AymaanPathan/pathway.io) |
| Company Brain | KT Brain · Shreyash Mandlapure | Links PRs, tickets, chats and documents so engineers can trace project decisions to their sources. | [Submission](https://www.wemakedevs.org/shreyash2k26) · [Demo](https://youtu.be/yG-YKcJTyhk) |
| Best Blog | Recall Tracer · Nishit Bariya, with Yash Suthar, Vinayak Vispute and Jayesh Yadav credited on the project | Traverses ingredient lots, batches and deliveries to name affected stores and surfaces gaps for review. | [Winning post](https://dev.to/nishitbaria/recall-33-stores-not-71-building-a-food-recall-agent-on-a-falkordb-graph-24o0) · [Team listing](https://www.wemakedevs.org/hackathons/falkordb/projects/all) |

## The Agent Harness Hackathon

The results name four project awards and one blog award. The CapyGuard repository describes which scans were live and which examples came from recorded sandbox runs. [Official results](https://www.wemakedevs.org/hackathons/trueforge/projects)

| Award | Project and public credits | Demonstrated mechanism | Evidence |
| --- | --- | --- | --- |
| Best Use of TrueForge | ONCALL · Elijah Umana | Pauses incident remediation for approval and checks the remote revert against persisted state after restart. | [Repository](https://github.com/ElijahUmana/oncall-trueforge-hackathon) |
| Best Code Quality | CapyGuard · Nelson Lai | Separates artifact inspection from writing a verdict supported by observed sandbox behavior. | [Repository](https://github.com/chinesepowered/hack-qofo) |
| Best UI | QUEST · Julius Olsson | Gives game characters persistent sessions with access to game state and real-world tools. | [Repository](https://github.com/Juliusolsson05/quest-hero) |
| Best Use of Bright Data | AgentRadar · Biswajeet Sahoo and Priyanshu Solanki | Maps review findings to a code graph and runs tests that visit the relevant lines. | [Repository](https://github.com/priyanshu-liveflow/completion_rca) |
| Best Blog | Mayday · Anamika Singh | Uses incident evidence from a simulated cloud, waits for approval and verifies recovery with fresh telemetry. | [Repository](https://github.com/Anamiiikka/Mayday) |
