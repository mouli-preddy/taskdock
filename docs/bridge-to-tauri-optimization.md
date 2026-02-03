# Bridge Backend to Tauri Optimization Plan

**Date**: 2026-01-29
**Goal**: Move functionality from Node.js WebSocket bridge to native Tauri for performance improvements

## Current Architecture

The app uses a **Node.js WebSocket bridge** (`src-backend/bridge.ts`) that routes 80+ RPC methods between the Tauri frontend and backend services. Every operation requires:
- JSON serialization/deserialization over WebSocket
- Round-trip latency for simple operations
- Broadcasting events to all clients unnecessarily

## Performance Bottlenecks

| Bottleneck | Impact | Location |
|------------|--------|----------|
| WebSocket serialization | All RPC calls | bridge.ts |
| Token management subprocess | Every ADO API call | ado-api.ts:16-54 |
| Configuration file I/O | Every settings access | bridge.ts:150-171 |
| File content transfer | Large PR diffs | bridge.ts:527-546 |
| Event broadcasting | All events to all clients | bridge.ts:178-186 |

---

## High-Impact Optimizations

### ✅ 1. ADO Token Management → Tauri Command
**Status**: 🔴 Not Started
**Priority**: P0 - Highest Impact
**Complexity**: Medium

**Current State**:
- Location: `src/main/ado-api.ts:16-54`
- Spawns `az CLI` subprocess from Node.js
- RPC call: `ado:get-token` (bridge.ts:222-223)

**Target State**:
- Move to Tauri command with Rust implementation
- Use `std::process::Command` for `az` calls
- Cache token in Tauri state with TTL

**Benefits**:
- Eliminate subprocess overhead in Node.js
- No WebSocket round-trip for token refresh
- Faster token caching with native memory

**Files to Modify**:
- [ ] `src-tauri/src/lib.rs` - Add token command
- [ ] `src/main/ado-api.ts` - Remove token logic, call Tauri
- [ ] `src-backend/bridge.ts:222-223` - Remove `ado:get-token` RPC
- [ ] `src/renderer/tauri-api.ts` - Add token invoke wrapper

**Estimated Impact**: -10% RPC calls, -50% token fetch latency

---

### ✅ 2. Configuration Management → Tauri Storage
**Status**: 🔴 Not Started
**Priority**: P0 - Highest Impact
**Complexity**: Low

**Current State**:
- Location: `src-backend/bridge.ts:150-171, 328-340`
- File-based JSON store (`SimpleStore` class lines 64-133)
- RPC methods: `config:load`, `config:save`, `config:is-configured`

**Target State**:
- Use Tauri's built-in storage plugin or Rust file I/O
- Direct frontend access to config
- Eliminate WebSocket for get/set operations

**Benefits**:
- No IPC overhead for frequent config access
- Reactive config updates (Tauri events)
- Simpler architecture

**Files to Modify**:
- [ ] `src-tauri/src/lib.rs` - Add config commands
- [ ] `src-backend/bridge.ts:150-171` - Remove config RPCs
- [ ] `src-backend/bridge.ts:64-133` - Remove SimpleStore class
- [ ] `src/renderer/tauri-api.ts` - Add config invoke wrappers
- [ ] Frontend components - Update config access

**Estimated Impact**: -15% RPC calls, instant config reads

---

### ✅ 3. File I/O Operations → Tauri File Plugin
**Status**: 🔴 Not Started
**Priority**: P1 - High Impact
**Complexity**: Low

**Current State**:
- Location: `src-backend/bridge.ts:527-546`
- Backend reads `review.json`, `walkthrough.json` from disk
- RPC method: `console-review:read-output`
- Sends file content over WebSocket (500MB limit)

**Target State**:
- Use Tauri file plugin for direct file access
- Frontend reads files directly (with scoped permissions)
- No serialization overhead

**Benefits**:
- Avoid 500MB payload limit issues
- Eliminate JSON serialization for large files
- Faster file access

**Files to Modify**:
- [ ] `src-tauri/Cargo.toml` - Add fs plugin
- [ ] `src-backend/bridge.ts:527-546` - Remove file read RPC
- [ ] Console review components - Use Tauri file API
- [ ] `src/renderer/tauri-api.ts` - Add file read wrappers

**Estimated Impact**: -5% RPC calls, -80% file transfer time

---

### ✅ 4. Settings Persistence → Tauri Storage
**Status**: 🔴 Not Started
**Priority**: P1 - High Impact
**Complexity**: Low

**Current State**:
- Location: `src-backend/bridge.ts:394-396, 575-586`
- Frequent RPC calls for:
  - `config:get-console-review-settings`
  - `config:set-console-review-settings`
  - `config:get-polling-settings`
  - `config:set-polling-settings`

**Target State**:
- Move to Tauri storage with frontend cache
- Use reactive state management (Zustand/Jotai)
- Only sync on change, not on every read

**Benefits**:
- Eliminate repeated IPC for frequently-accessed settings
- Client-side caching reduces backend load
- Better UX with instant reads

**Files to Modify**:
- [ ] Merge with optimization #2 (config management)
- [ ] Add frontend state store for settings
- [ ] Remove settings-specific RPCs

**Estimated Impact**: -10% RPC calls, instant setting reads

---

## Medium-Impact Optimizations

### ⚡ 5. Batch RPC Methods
**Status**: 🔴 Not Started
**Priority**: P2
**Complexity**: Low

**Current State**:
- Loading PR requires 5+ sequential RPC calls:
  - `ado:load-pr`
  - `ado:get-threads`
  - `ado:get-iterations`
  - `ado:get-changes`
  - `ado:get-file-content` (per file)

**Target State**:
- Create composite method: `ado:load-pr-full`
- Returns all data in single response
- Parallel backend fetching

**Benefits**:
- Reduce round-trips during initial load
- Lower latency for PR view

**Files to Modify**:
- [ ] `src-backend/bridge.ts` - Add batch method
- [ ] `src/main/ado-api.ts` - Add batch fetch logic
- [ ] PR viewer components - Use batch method

**Estimated Impact**: -20% RPC calls during PR load, -50% load time

---

### ⚡ 6. Event Filtering & Compression
**Status**: 🔴 Not Started
**Priority**: P2
**Complexity**: Medium

**Current State**:
- Location: `src-backend/bridge.ts:178-186`
- Broadcasts all events to all clients
- Terminal data events are high-frequency, uncompressed

**Target State**:
- Per-client event subscriptions
- Compress terminal data (gzip or delta encoding)
- Filter events based on client context

**Benefits**:
- Reduce terminal data spam
- Lower WebSocket bandwidth
- Better multi-window support

**Files to Modify**:
- [ ] `src-backend/bridge.ts:178-186` - Add subscription filtering
- [ ] Terminal manager - Add compression
- [ ] `src/renderer/tauri-api.ts` - Add subscription API

**Estimated Impact**: -40% WebSocket bandwidth, smoother terminal

---

### ⚡ 7. Client-Side Token Caching
**Status**: 🔴 Not Started
**Priority**: P2
**Complexity**: Low

**Current State**:
- Every ADO API call fetches token from backend
- No client-side token caching

**Target State**:
- Cache token in renderer with TTL (1 hour)
- Only refresh on expiry or 401 error
- Store in memory (not localStorage for security)

**Benefits**:
- Reduce `ado:get-token` RPC calls
- Faster ADO operations

**Files to Modify**:
- [ ] `src/renderer/tauri-api.ts` - Add token cache
- [ ] ADO service consumers - Use cached token

**Estimated Impact**: -50% token fetch calls

---

## Quick Wins (No Major Refactoring)

### 🚀 8. Response Caching
**Status**: 🔴 Not Started
**Priority**: P3
**Complexity**: Very Low

**Target**: Cache responses for:
- `ai:get-providers` (static list)
- `config:get-console-review-settings` (rarely changes)
- `wi:get-types`, `wi:get-area-paths` (semi-static)

**Implementation**: Simple in-memory cache with TTL

**Files to Modify**:
- [ ] `src-backend/bridge.ts` - Add caching layer

**Estimated Impact**: -5% RPC calls

---

### 🚀 9. Lazy-Load File Contents
**Status**: 🔴 Not Started
**Priority**: P3
**Complexity**: Low

**Target**: Only fetch diff content when user scrolls to file

**Files to Modify**:
- [ ] PR file viewer component - Add intersection observer
- [ ] `src/main/services/pr-file-cache-service.ts` - Optimize prefetch

**Estimated Impact**: -30% initial file fetches for large PRs

---

### 🚀 10. Worktree Management → Tauri Plugin
**Status**: 🔴 Not Started
**Priority**: P3
**Complexity**: Medium

**Current State**:
- Location: `src/main/git/worktree-service.ts`
- Git operations via Node.js child_process

**Target State**:
- Native Rust git operations (libgit2 or git2-rs)
- Or optimized subprocess calls in Rust

**Benefits**:
- Native git performance
- No subprocess overhead

**Files to Modify**:
- [ ] `src-tauri/Cargo.toml` - Add git2 crate
- [ ] `src-tauri/src/lib.rs` - Add git commands
- [ ] `src/main/git/worktree-service.ts` - Remove or simplify

**Estimated Impact**: -20% git operation time

---

## Migration Strategy

1. **Phase 1**: High-impact, low-complexity (Optimizations #2, #3, #4)
2. **Phase 2**: High-impact, medium-complexity (Optimizations #1)
3. **Phase 3**: Medium-impact optimizations (Optimizations #5, #6, #7)
4. **Phase 4**: Quick wins and polish (Optimizations #8, #9, #10)

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| RPC calls per PR load | ~25 | <10 |
| PR load time | ~2-3s | <1s |
| Config access latency | 20-50ms | <5ms |
| WebSocket bandwidth (terminal) | ~500KB/s | <200KB/s |
| Token fetch latency | 100-200ms | <50ms |

## Architecture Diagram (Target State)

```
┌─────────────────────────────────────────────────────────────────┐
│                  TAURI MAIN WINDOW (Rust)                       │
│                                                                  │
│  ✅ Token Management (Optimization #1)                          │
│  ✅ Configuration Storage (Optimization #2)                     │
│  ✅ File I/O (Optimization #3)                                  │
│  ✅ Settings Storage (Optimization #4)                          │
│  - Spawns backend process (minimal RPC)                         │
│                                                                  │
└──────────────┬───────────────────────────────────────────────────┘
               │
               │ Reduced RPC surface
               ▼
        ┌──────────────────────────┐
        │  NODE.JS BRIDGE BACKEND  │
        │  (src-backend/bridge.ts) │
        │                          │
        │  Remaining RPC methods:  │
        │  - ADO API proxying      │
        │  - AI review orchestration│
        │  - Terminal PTY management│
        │  - Complex business logic │
        │                          │
        └──────────────────────────┘
```

## Notes

- Tauri migration (commit d3df1f6) kept WebSocket RPC architecture
- Same communication overhead as Electron IPC, just different transport
- Moving top 4 optimizations eliminates ~40% of RPC calls
- Maintains separation of concerns while reducing IPC overhead
