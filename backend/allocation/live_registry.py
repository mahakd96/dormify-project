"""
In-process, thread-safe registry for allocation runs that are actively
solving. Two independent things are tracked here, both keyed by
allocation_run_id:

  1. Snapshots — the "current best solution so far", written by
     allocation.solver._LiveSolutionCallback. Pure data, safe to read from
     any thread in this process.
  2. The active CpSolver instance itself — registered for the duration of
     solver.Solve(), so a request handled by THIS SAME process can call
     request_stop_search() to invoke CpSolver.StopSearch() directly,
     without waiting for the solver's own DB-polling watcher thread to
     notice. This is a best-effort fast path, not the only mechanism: see
     allocation.solver._run_stop_watcher for the process-agnostic fallback
     (a dedicated thread owned by the solve itself that polls
     AllocationRun.status independently of CP-SAT's solution callback).

This is a pure-Python fast path: dicts guarded by one lock, no external
infrastructure (no Redis/Celery). It is intentionally NOT the only source
of truth for live snapshots — see AllocationRun.live_snapshot for why a
throttled DB fallback also exists (this process may not be the one that
later serves the preview or stop-and-save request).
"""

import threading

_lock = threading.Lock()
_snapshots = {}
_active_solvers = {}


def get(run_id):
    """Return the latest snapshot dict for run_id, or None if none exists."""
    with _lock:
        return _snapshots.get(run_id)


def set(run_id, snapshot):
    """Store/replace the latest snapshot dict for run_id."""
    with _lock:
        _snapshots[run_id] = snapshot


def clear(run_id):
    """Drop any snapshot held for run_id (call once the run reaches a terminal status)."""
    with _lock:
        _snapshots.pop(run_id, None)


def register_solver(run_id, solver):
    """Register the live CpSolver instance for run_id, for the duration of Solve()."""
    with _lock:
        _active_solvers[run_id] = solver


def unregister_solver(run_id):
    """Drop the CpSolver reference for run_id (call as soon as Solve() returns)."""
    with _lock:
        _active_solvers.pop(run_id, None)


def request_stop_search(run_id):
    """
    If the CpSolver for run_id is registered in THIS process, call its
    StopSearch() directly and return True. Returns False when nothing is
    registered here (the solve may be running in a different process, or
    may already have finished) — callers must not treat False as an
    error; the DB status flag + the solve's own watcher thread remain the
    authoritative, process-agnostic way a stop request eventually takes
    effect.
    """
    with _lock:
        solver = _active_solvers.get(run_id)
    if solver is None:
        return False
    try:
        solver.StopSearch()
        return True
    except Exception:
        return False
