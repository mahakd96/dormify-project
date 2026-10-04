# Dormitory Inventory Data

Operational housing inventory is intentionally **not included** in this public repository.

The importer is available at:

`api/management/commands/import_buildings_final.py`

For local development or evaluation, provide your own authorized test workbook outside version control and run a dry run before importing it:

```bash
python manage.py import_buildings_final "/path/to/local/inventory.xlsx" --dry-run
```

After validating the output:

```bash
python manage.py import_buildings_final "/path/to/local/inventory.xlsx"
```

Do not commit real housing inventories, room/bed identifiers, production exports, or institutional operational data to this repository.
