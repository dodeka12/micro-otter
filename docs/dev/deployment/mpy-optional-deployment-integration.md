# Optional MPY Deployment Integration Contract

## Purpose

Define the exact integration boundary for optional `.mpy` uploads while preserving the existing deployment architecture.

## Critical Constraints

- Do not create a parallel deployment pipeline.
- Do not create a second upload coordinator.
- Keep transport, progress, retry, and reset behavior in the existing deployment flow.

## Existing Deployment Ownership

- `DeviceDeployment` remains the orchestration entrypoint used by UI actions.
- `RuntimeDeployment` remains owner for runtime and tools file preparation/upload.
- `CollectionDeployment` remains owner for collection and node package library preparation/upload.

## Extension Seam

The only extension seam is file selection strategy before upload:

1. Build the same candidate source file sets as today.
2. Optionally transform eligible `.py` selections to profile-matched `.mpy` artifacts.
3. Continue with the same upload methods and operation phases.

No other behavior is moved or duplicated.

## Data Flow Contract

1. Deployment request enters existing public API (`DeviceDeployment`).
2. Existing preparation phase gathers runtime/tools/node-package candidates.
3. MPY profile evaluation and file-selection decision runs.
4. Existing upload execution sends selected files.
5. Existing state updates, events, and reset behavior run unchanged.

## Scope For MPY Selection

MPY profile-based selection applies to package groups already uploaded by deployment:

- Device tools package.
- Active runtime package.
- Node packages used by the deployed collection.

## Failure And Fallback Contract

- If compatible precompiled artifacts are available, upload the MPY artifact set through existing upload code.
- If required artifacts are missing, continue only through the existing fallback decision path (prompt and optional source upload).
- Cancellation must abort before first upload call and report canceled status via existing operation flow.
