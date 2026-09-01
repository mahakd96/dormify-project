\# Dormitory Inventory Import



Source workbook:

`מיטות במעונות.xlsx`



Django importer:

`api/management/commands/import\_buildings\_final.py`



From the `backend` directory, validate first without changing the database:



python manage.py import\_buildings\_final "data/מיטות במעונות.xlsx" --dry-run



Expected inventory:

\- 11 dorm types

\- 91 buildings

\- 1,016 apartments

\- 3,079 rooms

\- 3,371 beds



After a successful dry run:



python manage.py import\_buildings\_final "data/מיטות במעונות.xlsx"



Do not use `--replace` unless the existing inventory has been reviewed and a database backup has been taken.

