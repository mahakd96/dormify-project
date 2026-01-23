# 🏠 Dormify Backend (Django + Python)

Backend API for Dormify - Technion Dormitory Management System.

---

## 🛠️ Technologies

- **Python 3.10+**
- **Django 4.2** - Web framework
- **Django REST Framework** - API
- **PostgreSQL** - Database
- **JWT** - Authentication
- **MiniZinc** - Allocation algorithm (optional)

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
│   └── solver.py         # MiniZinc integration
│
├── manage.py             # Django commands
├── seed.py               # Populate test data
├── requirements.txt      # Python dependencies
└── .env                  # Environment variables
```

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

Edit `.env` file:
```
DB_NAME=dormify
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD_HERE
```

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
| POST | `/api/auth/register/` | Register |
| GET | `/api/auth/me/` | Get current user |

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
2. Login with: `admin@technion.ac.il` / `123456`

---

## 🧪 Test Credentials

| Email | Password | Role |
|-------|----------|------|
| admin@technion.ac.il | 123456 | Central Admin |
| canada.boss@technion.ac.il | 123456 | Region Boss |
| canada.emp1@technion.ac.il | 123456 | Employee |

---

## 🔧 MiniZinc Setup (Optional)

For advanced allocation algorithm:

1. Download MiniZinc: https://www.minizinc.org/software.html
2. Install and add to PATH
3. Install Python library: `pip install minizinc`

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
