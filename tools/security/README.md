Autonomous vulnerability analysis
=================================

This directory contains lightweight, repository-local helpers for security
research workflows.

`autonomous_vulnerability_analysis.py` performs a heuristic static scan over
the high-priority V8 attack surfaces listed in the research prompt:

* `src/compiler/`
* `src/maglev/`
* `src/wasm/`
* `src/objects/`
* `src/heap/`
* `src/runtime/`
* `src/builtins/`
* `src/sandbox/`

The tool approximates the requested pipeline by:

1. building a lightweight repository call graph
2. identifying attacker-reachable entry points
3. flagging tainted memory operations
4. detecting DCHECK-only safety checks
5. highlighting unchecked casts, integer-overflow size calculations, and
   stale-pointer patterns
6. emitting structured vulnerability reports

Usage:

    python3 tools/security/autonomous_vulnerability_analysis.py \
        --root /path/to/v8 --max-findings 25

For machine-readable output:

    python3 tools/security/autonomous_vulnerability_analysis.py \
        --format json
