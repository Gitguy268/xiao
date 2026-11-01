# Performance results

The targets come from the Library plan (brief §11). These are measurements, not estimates. Each one names its tool, so it can be rerun.

**Machine:** Apple M4, 16 GB, macOS 27.0.1. Zen 1.23.3b (Firefox 158), headless, throwaway profile.

## Startup (`node test/e2e/startup.mjs`)

Each figure is the median of 5 starts. The first start of each series builds Xiao.app and is left out. Time runs from process start to session restored.

| Build | Startup | First paint | Main process memory |
|---|---|---|---|
| 0.3 before the Library (baseline kit, 2026-10-21) | 572 ms | 523 ms | 246 MB |
| With the Library code, Library off | 590 ms (+3.1%) | 538 ms | 242 MB |
| With the Library on | 611 ms (+6.8%) | 558 ms | 243 MB |

- The target is less than 5% slower. With the Library off it is met.
- With the Library on, the first series was over target. The download hook loaded Firefox's download list during startup, so it now waits until 10 s after startup. Phase 7 re-measures this with interleaved runs.
- With the Library on and its page closed, the database stays closed after startup (`database: false` in every run).

**Final figures, 2026-10-26: inconclusive, an open release risk.** Other programs held the machine at a load average of 8 to 58 throughout.
- Wall clock, alternating kits (medians of 4 or 5 starts): 871 ms (0.3 baseline) and 4,879 ms (this build), then 8,971 and 14,085 ms, then 2,488 and 7,930 ms, then 11,523 and 5,656 ms. This build was slower in three of four pairs; the spread inside each kit is larger than the gap.
- An earlier series at load 8 gave 1,940 ms against the 590 ms recorded on 2026-10-21 for the same Library code.
- The main process's CPU time up to 10 s after start, which a busy machine disturbs much less (`parentCpuMs`): 5,365 ms (baseline) and 5,641 ms (this build), then 6,238 and 6,191 ms. That is no sign of new work at startup.
- The target (less than 5% slower) cannot be called met until wall-clock starts are measured on a quiet machine:

```sh
# the 0.3 baseline kit: d1b5789 + .git/xiao-baseline/0.3-tracked.patch + 0.3-untracked.tgz, then npm ci && npm run build
for i in 1 2 3; do
  RUNS=5 KIT=/path/to/base03/dist/kit STARTUP_OUT=base-$i.json node test/e2e/startup.mjs
  RUNS=5 STARTUP_OUT=cur-$i.json node test/e2e/startup.mjs
done
```

## Memory (`node test/e2e/memory.mjs`)

Baseline, before the Library: 1,949 MB with six busy sites after settling, 1,738 MB after minimise (one run, 2026-10-21).

With the Library work, Library off (one run, 2026-10-26): 1,361 MB after settling, 1,297 MB after minimise. The six sites are live and change from day to day, so the two runs are not a like-for-like comparison.

## Search

| Test | Items | p95 per query |
|---|---|---|
| node (`test/library.test.mjs`) | 10,000 synthetic | well under 100 ms (whole test 80 ms for 40 queries) |
| Real Xiao (`run.mjs` "10,000 files") | 10,109 indexed files | 8.0–8.2 ms |

The background scan of 10,100 real files and folders took 312–321 ms, in batches of 400 with pauses in between.

## Library pack

- 145 KB download.
- It runs nothing until opened, apart from the download hook while "Remember my downloads" is on.

## Local AI (Assist, `AI=1 E2E_TOR=0 npm run e2e`)

MiniCPM5 2B (Q4_K_M) in the notes-ai pack, wllama on the CPU, one thread (`n_gpu_layers: 0`), headless Zen. One run, 2026-10-26.

| Measure | Result |
|---|---|
| First answer, the model loaded from disk first | 79.4 s |
| Warm answer (model already loaded) | 20.4 s |
| The model's content process while loaded | 3,472 MB |
| After idle | the model's page is closed and its process ends (2 minutes by default; the test uses 5 s) |
| Stopped mid-answer | the answer fails at once with the stop, and the next question gets an answer from a fresh model page |

- The page's passages show at once, before the model writes, so a question is useful from the first second.
- Before these runs, two faults made a question fail with "The local AI stopped.": a waiting model page kept its idle countdown while it answered, and a model page on its way out could take a new question. Both are fixed (`Assist.feed`, `Assist.stopping`).
