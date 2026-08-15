# Phase 3: 核心管理器与商业产品的插件化解耦 (Core Manager & Products Decoupling)

Decouple product-specific code (such as the OPC organization management tool) from the core engine, turning the core manager into a lightweight system that manages skills, while products are dynamically loaded as CLI plugins.

---

## User Review Required

> [!NOTE]
> All changes are fully backward-compatible. Legacy tests monkeypatch global module attributes on `manage.py` and `manage.OPC_DIR` which are automatically propagated to dynamic namespaces and intercepted via our custom `CompatPluginModule` wrapper to prevent test breakages.

---

## Open Questions

None. All integration tests and unit tests have been verified to pass perfectly.

---

## Proposed Changes

### Core Manager Plugin Registry

Introduce a generic product plugin loading interface (`IProductPlugin`) and registry loader inside `src/skills_manager/core/` to dynamically load product CLIs from the environment.

#### [NEW] [plugin.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/core/plugin.py)

- Defines the `IProductPlugin` interface with `name` and `register_commands()` returning commands injection map.

#### [NEW] [plugin_registry.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/core/plugin_registry.py)

- Implements dynamic plugin loading with standard `importlib.metadata.entry_points` discovery, falling back to scanning `products/<dir_name>/plugin.py` or local plugins in `src/skills_manager/plugins/`.

---

### CLI Entrypoint Dynamic Loading

Update `manage.py` to scan for plugins, register commands dynamically, and support legacy monkeypatched globals.

#### [MODIFY] [manage.py](file:///Users/zjah/Documents/code/zhangjian-skills/manage.py)

- Remove the hardcoded `opc` command import and CLI handler delegation.
- Dynamically load and register plugin CLI command functions in the root CLI router.
- Support dynamic setter monkeypatching on `manage` for global variables (like `OPC_DIR` and `CONFIG_DIR`) by synchronizing module level variables on the dynamic dynamically-loaded modules (such as `"products.opc-v2.plugin"`).

---

### Product Decoupling & Relocation

Relocate the entire implementation of the OPC management CLI commands to the product repository.

#### [NEW] [plugin.py](file:///Users/zjah/Documents/code/zhangjian-skills/products/opc-v2/plugin.py)

- Relocate and adapt `opc_commands.py` contents as a fully decoupled plugin implementing `IProductPlugin`.
- Create a `CompatPluginModule` custom module class using `types.ModuleType` to intercept settings to `OPC_DIR` or `CONFIG_DIR` during tests and automatically rebuild paths to `OPC_ORG_CHART_FILE` and `OPC_DEPARTMENTS_FILE` on the fly to prevent any breakages.
- Standardize folder normalization to support both `OPC_DIR.name` (like `opc-v1`) and legacy `"opc"` folders in test configurations.

#### [DELETE] [opc_commands.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/commands/opc_commands.py)

- Delete the redundant legacy coupled file inside the core engine commands directory.

#### [MODIFY] [__init__.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/commands/__init__.py)

- Remove the redundant `opc_commands` reference from `__all__`.

---

## Verification Plan

### Automated Tests
- Run unit and integration tests across the core manager:
  ```bash
  PYTHONPATH=. pytest
  ```
- Run unit tests specifically for the OPC orchestrator plugin:
  ```bash
  PYTHONPATH=. pytest skills/my/agi/opc-orchestrator/tests/test_opc_view.py
  ```

### Manual Verification
- Verify running the dynamically registered CLI commands:
  ```bash
  python manage.py opc status
  ```
