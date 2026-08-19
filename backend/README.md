# 🏠 Dormify Backend (Django + Python)

Backend API for Dormify - Technion Dormitory Management System.

---

## 🛠️ Technologies

- **Python 3.10+**
- **Django 4.2** - Web framework
- **Django REST Framework** - API
- **PostgreSQL** - Database
- **JWT** - Authentication
- **Google OR-Tools (CP-SAT)** - Allocation algorithm

---

## 📁 Project Structure

```
dormify-django/
├── dormify/              # Main project settings
│   ├── settings.py       # Configuration
│   ├── urls.py           # Main routes
│   └── wsgi.py           # Server
│
├── api/                  # API app
│   ├── models.py         # Database tables
│   ├── views.py          # API logic
│   ├── urls.py           # API routes
│   ├── serializers.py    # JSON conversion
│   └── admin.py          # Admin panel
│
├── allocation/           # Allocation algorithm
│   └── solver.py         # OR-Tools CP-SAT allocation engine
│
├── manage.py             # Django commands
├── seed.py               # Populate test data
└── requirements.txt      # Python dependencies
```

Note: the `.env` file lives in the **project root** (one level above `backend/`), not inside `backend/` itself — `dormify/settings.py` loads it from there.

---

## 🚀 Setup Instructions

### 1. Install Python

Download from: https://www.python.org/downloads/
(Version 3.10 or higher)

**Important:** Check "Add Python to PATH" during installation!

### 2. Install PostgreSQL

Download from: https://www.postgresql.org/download/

Create database:
```sql
CREATE DATABASE dormify;
```

### 3. Extract Project

Extract to: `C:\dormify\backend\`

### 4. Configure Environment

Edit `.env` in the **project root** (not inside `backend/` — see the note above):
```
DB_NAME=dormify
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD_HERE
DB_HOST=localhost
```

`DB_HOST=localhost` assumes PostgreSQL is running locally on your machine — use a different value (e.g. a Docker service name) if your database runs elsewhere. `DEBUG` defaults to `False` (see `dormify/settings.py`); it is not part of the general environment example above, but note that `python seed.py` specifically requires `DEBUG=True` to run — see Test Credentials below.

### 5. Create Virtual Environment (Recommended)

```bash
cd C:\dormify\backend
python -m venv venv
venv\Scripts\activate
```

### 6. Install Dependencies

```bash
pip install -r requirements.txt
```

### 7. Run Migrations

```bash
python manage.py migrate
```

### 8. Create Test Data

```bash
python seed.py
```

### 9. Create Admin User (Optional)

```bash
python manage.py createsuperuser
```

### 10. Start Server

```bash
python manage.py runserver
```

Server runs at: `http://localhost:8000`

---

## 🔌 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login/` | Login |
| GET | `/api/auth/me/` | Get current user |

Public self-registration has been removed. Staff accounts are created by an admin via `POST /api/staff-users/`.

### Students
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/students/` | List students |
| POST | `/api/students/` | Create student |
| GET | `/api/students/{id}/` | Get student |
| PUT | `/api/students/{id}/` | Update student |
| DELETE | `/api/students/{id}/` | Delete student |

### Buildings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/buildings/` | List buildings |
| GET | `/api/buildings/{id}/` | Get building |
| GET | `/api/buildings/{id}/rooms/` | Get rooms |

### Transfers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/transfers/` | List transfers |
| POST | `/api/transfers/` | Create transfer |
| PUT | `/api/transfers/{id}/approve/` | Approve |
| PUT | `/api/transfers/{id}/reject/` | Reject |

### Allocation
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/allocation/run/` | Run allocation |
| GET | `/api/allocation/history/` | Get history |

### Statistics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/statistics/` | Dashboard stats |

---

## 🎛️ Admin Panel

Django includes a FREE admin panel!

1. Go to: `http://localhost:8000/admin/`
2. Login with the admin account created by `seed.py` (see Test Credentials below)

---

## 🧪 Test Credentials

`seed.py` no longer uses a fixed, reusable password (see the script's docstring). As an intentional safety measure, it refuses to run unless `DEBUG=True` is set (in your local `.env`), so it can't be pointed at a production database by accident. Once that's set, it creates:

| Email | Role |
|-------|------|
| admin@technion.ac.il | Central Admin |
| canada@technion.ac.il | Region Boss (Canada) |
| canada.emp@technion.ac.il | Employee (Canada) |
| hasmaha@technion.ac.il | Region Boss (Hasmaha) |
| mizrah@technion.ac.il | Region Boss (Mizrah) |

The password for each account is taken from the `SEED_ADMIN_PASSWORD` / `SEED_STAFF_PASSWORD` environment variables if set, otherwise a random password is generated per run and printed once to the console (never written back into source).

---

## 📝 Development Commands

```bash
# Run server
python manage.py runserver

# Create migrations after model changes
python manage.py makemigrations

# Apply migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Shell (for testing)
python manage.py shell
```

---

## 🔗 Connect Frontend (React)

The React frontend connects to this backend via API.

In React, update `api.js`:
```javascript
const API_URL = 'http://localhost:8000/api';
```

---

Built for Technion Final Project - 2026
