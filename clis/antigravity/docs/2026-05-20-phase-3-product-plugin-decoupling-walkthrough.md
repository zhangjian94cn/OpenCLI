# Phase 3 Walkthrough: Core Manager & Products Decoupling

We have successfully completed Phase 3 of the step-by-step optimization of the `skills-manager` codebase, completely decoupling commercial/product-specific tools (like the OPC organization manager) from the core engine into a dynamic plugin-based architecture.

---

## 🛠️ Changes Made

### 1. Defined Plugin Interfaces & Loaders
- **[plugin.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/core/plugin.py)**:
  - Created the generic `IProductPlugin` abstract base class to enforce plugin standardization.
- **[plugin_registry.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/core/plugin_registry.py)**:
  - Built dynamic loading using standard Python `importlib.metadata.entry_points`.
  - Added scanning fallback loaders for directories inside `products/` (e.g., `products/*/plugin.py`) and standard plugins folder `src/skills_manager/plugins/` to guarantee resilient plugin discovery.

### 2. Adapted and Relocated OPC Product Commands
- **[plugin.py](file:///Users/zjah/Documents/code/zhangjian-skills/products/opc-v2/plugin.py)**:
  - Fully relocated all implementation files and helpers from the old coupled module to this product-specific plugin.
  - Wrapped commands and handlers inside `OpcPlugin` implementing `IProductPlugin`.
  - Implemented `CompatPluginModule` custom module class using `types.ModuleType` to dynamically intercept and synchronize path modifications to global variables like `OPC_DIR` and `CONFIG_DIR` during test runs.
  - Normalization check `_normalize_opc_department_folder` has been updated to check for both the dynamic `OPC_DIR.name` as well as the legacy `"opc"` prefix to ensure compatibility under different configuration setups.
- **[DELETE] [opc_commands.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/commands/opc_commands.py)**:
  - Successfully deleted the deprecated and coupled legacy code.

### 3. Decoupled Core CLI Entry Point
- **[manage.py](file:///Users/zjah/Documents/code/zhangjian-skills/manage.py)**:
  - Cleaned up all hardcoded imports and direct handler references of the `opc` command.
  - Integrated dynamic plugin loading inside CLI startup, resolving plugin dependencies and injecting dynamically registered commands.
  - Added attribute setter synchronization inside `DynamicManageModule.__setattr__` to automatically propagate monkeypatched properties to dynamic product modules (like `"products.opc-v2.plugin"`) to maintain backward compatibility under test setups.
- **[__init__.py](file:///Users/zjah/Documents/code/zhangjian-skills/src/skills_manager/commands/__init__.py)**:
  - Removed `"opc_commands"` from the list of exported subcommands.

---

## 🧪 Verification Results

### 1. OPC Orchestrator Unit Tests
Running specifically the OPC orchestrator test file verifies that plugin commands, path normalizers, and the backward compatibility dynamic attribute propagation layer work exactly as designed:
```bash
PYTHONPATH=. pytest skills/my/agi/opc-orchestrator/tests/test_opc_view.py
```
**Output**:
```text
============================= test session starts ==============================
platform darwin -- Python 3.9.11, pytest-8.4.2, pluggy-1.6.0
rootdir: /Users/zjah/Documents/code/zhangjian-skills
configfile: pyproject.toml
plugins: anyio-4.4.0, langsmith-0.3.19, hydra-core-1.3.2, cov-7.0.0
collected 4 items

skills/my/agi/opc-orchestrator/tests/test_opc_view.py ....               [100%]

============================== 4 passed in 0.03s ===============================
```

### 2. Core Repository Integration Tests
Executing the complete pytest suite verified that there were zero regressions in any of the core sync, verify, config, or helper functions:
```bash
PYTHONPATH=. pytest
```
**Output**:
```text
============================= test session starts ==============================
platform darwin -- Python 3.9.11, pytest-8.4.2, pluggy-1.6.0
rootdir: /Users/zjah/Documents/code/zhangjian-skills
configfile: pyproject.toml
testpaths: tests
plugins: anyio-4.4.0, langsmith-0.3.19, hydra-core-1.3.2, cov-7.0.0
collected 128 items

tests/test_clawhub_sync.py ......                                        [  4%]
tests/test_config_validator.py ...                                       [  7%]
tests/test_core.py .......                                               [ 12%]
tests/test_env_commands.py .........................                     [ 32%]
tests/test_manage_grouped_skills.py ........                             [ 38%]
tests/test_manage_logic.py .....................                         [ 54%]
tests/test_migration_path_references.py .                                [ 55%]
tests/test_resource_index.py ...........                                 [ 64%]
tests/test_resource_metadata.py ..........                               [ 71%]
tests/test_runtime_layout.py ....                                        [ 75%]
tests/test_skill_index_symlink.py ...                                    [ 77%]
tests/test_skill_xref.py ......                                          [ 82%]
tests/test_sync_manager.py .........                                     [ 89%]
tests/test_unified_config.py ..                                          [ 90%]
tests/test_unified_sync.py ............                                  [100%]

============================= 128 passed in 5.47s ==============================
```

---

## 📈 Next Up (Phase 4)
We are ready to proceed with Phase 4: **Orchestration State DB & Dashboard (多机运维离线状态机与持久化大屏)** to record health checks and eliminate SSH lookup latency.
