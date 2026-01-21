# CloudGate: Working Guide (dev + ops)

Этот документ — источник правды для повседневной работы с проектом CloudGate.
Здесь описано: локальная разработка, Docker-флоу и понимание прод-контура в Yandex Cloud.

Документ практический. Без философии. Только то, что реально используется.

---

## 1) Репозиторий и структура

CloudGate — монорепа на pnpm workspaces.

Основные пакеты:
- apps/api — backend API (Fastify + Prisma)
- apps/web — frontend (Next.js)
- packages/shared — общие схемы и типы
- infra / docker-compose — инфраструктура

Ожидаемые git-remotes:
- origin / github — основной репозиторий (PR, история, релизы)
- optional: wslrepo — локальное зеркало для WSL (если используешь)

Проверка:
git remote -v
git branch -vv

---

## 2) Локальная разработка (Windows)

### Пререквизиты
- Git
- Node.js 20 (через Volta)
- pnpm 9
- Docker Desktop

Проверка версий:
node -v
pnpm -v
docker version

### Установка зависимостей
cd C:\project\CloudGate
pnpm install

---

## 3) База данных и почта (Docker)

Поднять PostgreSQL и Mailhog:
pnpm docker:db

Проверка:
docker ps

Mailhog UI:
http://localhost:8025

---

## 4) Prisma (важно для Windows)

Если ловишь EPERM / query_engine — делай строго так:

1) Остановить все node процессы
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

2) Удалить временные файлы Prisma
Get-ChildItem -Recurse -Force .\node_modules\.pnpm -Filter query_engine-windows.dll.node.tmp* -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

3) Поднять базу
pnpm docker:db

4) Пересобрать Prisma
pnpm --filter @cloudgate/api exec prisma generate
pnpm --filter @cloudgate/api exec prisma migrate dev

---

## 5) Запуск API и WEB (dev режим)

В двух разных терминалах:

API:
pnpm dev:api

WEB:
pnpm dev:web

Health-check:
http://127.0.0.1:3001/health
http://127.0.0.1:3000/api/health

---

## 6) Docker mode (полный стек локально)

Важно: если dev:web уже занят на 3000 — docker:web не поднимется.

Освобождение портов:
 = 3000,3001,5555
foreach ( in ) {
  Get-NetTCPConnection -LocalPort  -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id  -Force -ErrorAction SilentlyContinue }
}

Запуск:
 = '1'
pnpm docker:up

Остановка:
pnpm docker:down

---

## 7) Yandex Cloud (прод — концептуально)

Прод-контур:
- GitHub → CI → Docker images
- YC Container Registry
- YC VM / instances
- docker compose или systemd

WireGuard node:
- отдельная VM
- управление по SSH из API
- параметры через env:
  WG_NODE_SSH_HOST
  WG_NODE_SSH_USER
  WG_NODE_SSH_OPTS

---

## 8) Типовые проблемы

### Port already in use
Используй стандартный скрипт из раздела Docker mode.

### Prisma не видит БД
- Проверь docker ps
- DATABASE_URL указывает на localhost:5432
- контейнер cloudgate-db запущен

---

Конец документа.