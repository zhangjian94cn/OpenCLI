# Phase 2: Hub 命名空间分层与别名 (Hierarchical Hub Namespaces Gateway)

Introduce a priority-based first-wins naming resolution, suffix-based redirects, and a nested namespace folder structure under `.store/hub/` to resolve namespace conflicts without silent overwrites, while keeping legacy agent scanners 100% backward compatible.

---

## User Review Required

> [!NOTE]
> All changes are fully backward-compatible. Older AI agent versions that only support flat directory scanning will resolve clean priority aliases (e.g. `wechat-writing` maps to the custom `me` namespace version), while new namespace-aware agents can leverage `.store/hub/@namespace/` for structured access.

---

## Open Questions

None. The proposed solution fits exactly within the existing architecture without modifying any APIs or configuration schemas.

---

## Proposed Changes

### Core Hub Build Optimization

Modify the symlink creation loop inside `deploy_commands.py` to:
1. Standardize namespace resolution (mapping namespaces like `me`, `ziyin`, `skills-sh`, `ceeon`, etc.).
2. Prioritize namespace candidates so that `me` version gets the primary clean flat link.
3. Automatically generate suffix-based direct flat mapping redirects for conflicting resources in other namespaces (e.g., `wechat-writing--community`).
4. Generate a nested namespace symlink folder structure inside `.store/hub/` (e.g., `.store/hub/@me/`, `.store/hub/@community/`).

---

#### [MODIFY] [deploy_commands.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/commands/deploy_commands.py)

- **_collect_hub_entries_from_registry**: Refactor to return a list of dictionaries containing metadata (`rel_key`, `path`, `namespace`, `name`) instead of a flat `dict[str, Path]`.
- **build**:
  - Update fallback scan when registry is not refreshed to infer namespace based on the folder path (`me` for `MY_SKILLS` or `DIST_DIR`, `community` or others for `COMMUNITY_SKILLS`, etc.).
  - Sort all candidates by namespace priority: `me` (0) > `ziyin` (1) > `skills-sh` (2) > other namespaces (3).
  - Loop through sorted candidates:
    - Link the first candidate to the clean flat path: `AI_DIR / rel_key`.
    - Link subsequent conflicting candidates to: `AI_DIR / f"{rel_key}--{namespace}"`.
    - Create nested namespace links for all candidates under: `AI_DIR / f"@{namespace}" / rel_key`.

---

#### [MODIFY] [docs_commands.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/commands/docs_commands.py)

- **docs_sync**: Filter out nested namespace directories (starting with `@`) and suffix-based redirects (containing `--`) from the `.hub/` count to ensure accurate stats are populated in the README.md stats table.

---

#### [MODIFY] [verify_commands.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/commands/verify_commands.py)

- **_collect_hub_skill_keys**: Filter out nested namespace folders (starting with `@`) and suffix-based redirects (containing `--`) from the primary flat registry/hub consistency check, ensuring they don't trigger extra entry warnings or failures, while allowing the broken symlink check to recursively validate all symlinks (flat, nested, and suffixed).

---

## Verification Plan

### Automated Tests
- Run the full pytest suite:
  ```bash
  pytest
  ```
- Run the repository verification tool:
  ```bash
  python manage.py verify
  ```

### Manual Verification
- Run the deployment:
  ```bash
  python manage.py deploy
  ```
- Check `.store/hub/` directory structure to verify:
  - Nested directories like `@me/` and `@community/` are created correctly.
  - Suffix-based files are generated for conflicting names.
  - Verification succeeds with 100% passes.
