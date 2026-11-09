# Проблемы, возникшие при разработке LPS

Журнал проблем и решений. Записывается по мере реализации.

---

## P1. Prisma ORM 8 не поддерживает SQLite в `orm init`

**Дата**: этап 0
**Статус**: решено (переход на Prisma 7)

`bunx prisma@latest orm init --yes --target sqlite --authoring psl` падает:

```
✘ [CLI.INIT_INVALID_FLAG_VALUE] Invalid value for --target
  why: `--target sqlite` is not one of: postgres, mongodb.
```

Плюс:
- `prisma` CLI latest = `8.0.0-rc.33` (RC, не стабильная);
- `@prisma/orm-sqlite` существует только в виде `8.0.0-rc.*`-dev сборок;
- публичная документация Prisma 8 для SQLite использует внутренние `@internal/*` пакеты.

**Решение**: использовать **стабильную Prisma 7.10.1** (`@prisma/client@7`, `prisma@7`).
Prisma 7 тоже работает без Rust-движка (обязательные driver-адаптеры, генератор
`prisma-client`), официально поддерживает Bun и `bun build --compile`, сохраняет
привычный API (`prisma.user.findMany()`). Свойства «нет движка → single-file» сохранены.

---

## P2. Нет готового Prisma driver-адаптера поверх `bun:sqlite` / `node:sqlite`

**Дата**: этап 0
**Статус**: решено (свой адаптер)

Из коробки для SQLite есть:
- `@prisma/adapter-better-sqlite3` — тянет нативный `better-sqlite3` (`.node`),
  рискованно для `bun build --compile`;
- `@prisma/adapter-libsql` — тянет нативные биндинги `@libsql/client`;
- `@prisma/adapter-bun-sqlite` / `@prisma/adapter-node-sqlite` — **не существуют** в npm.

При этом Bun 1.4.4 имеет встроенные `bun:sqlite` **и** `node:sqlite`
(проверено: `DatabaseSync`, `StatementSync` доступны) — без единого нативного
зависимого модуля.

**Решение**: написать тонкий свой адаптер `src/core/db/bun-sqlite-adapter.ts`
по контракту `@prisma/driver-adapter-utils` (SqlDriverAdapterFactory / SqlDriverAdapter)
поверх `bun:sqlite`. Объём ~100–150 строк, полный контроль над single-file сборкой.

---

## P3. Парсер `/etc/os-release` не понимал значения без кавычек

**Дата**: этап 1
**Статус**: решено

Regex требовал закрывающую кавычку (`^ID="?([^"\n]*)"` → не матчился `ID=ubuntu`
без кавычек). `detectDistro` падал с «Unsupported distribution: unknown».

**Решение**: поддержать обе формы — `KEY="value"` и `KEY=value`:
`^KEY=(?:"([^"]*)"|([^\n]*))`.

---

## P4. Коллизия уникального ключа Command: alias и builtin с одним именем

**Дата**: этап 1
**Статус**: решено (миграция)

`@@unique([name, path])` не различал alias и builtin — у обоих `path=""`
(например, `cd` как builtin и `cd` как alias). Пришлось развернуть ключ
до `@@unique([name, path, kind])` миграцией `command_identity_includes_kind`.

**Побочный эффект**: `prisma migrate dev` в неинтерактивной среде (pipe/CI)
падает с «environment is non-interactive». Миграции создаются вручную:
`prisma migrate diff --from-migrations ... --to-schema ... --script` →
новая папка в `prisma/migrations/` → `prisma migrate deploy`.
Затем обязательно `bun run schema:sync` для embedded-миграций.

---

## P5. `bun run` добавляет `node_modules/.bin` в PATH при сканировании

**Дата**: этап 1
**Статус**: принято (не баг)

Скан, запущенный через `bun run src/index.ts scan`, видит в PATH каталоги
`node_modules/.bin` и shim-каталог Bun — это артефакт запуска через bun run.
Скомпилированный бинарник (`dist/lps`) запускается с чистым PATH пользователя.
Не исправляем: PATH — источник истины о доступных командах.

---

## P6. `homedir()` под sudo возвращает /root — пропуск файлов пользователей

**Дата**: этап 4
**Статус**: решено

Скан под sudo видел только `/root/Applications` вместо `/home/*/Applications`
(AppImage, alias-rc, `~/.local/bin`). Модули использовали `os.homedir()`.

**Решение**: `src/core/util/users.ts` — список login-пользователей из
`/etc/passwd` (`listUsers()`, `userHomeDirs()`). Все сканеры идут по домам
всех пользователей; `--users` сужает выборку для alias.

---

## P7. Нет GC удалённых сущностей между сканами

**Дата**: этап 4
**Статус**: отложено (v2)

Scan делает только upsert: удалённые пакеты/команды остаются в БД как stale.
Для индекса это терпимо (видно по расхождению с `dpkg -l`), но в v2 стоит
помечать `lastSeenAt` и подчищать записи, отсутствующие N сканов подряд.

---

## P8. Коммит сломанного кода: tsc в pipe маскирует ошибку компиляции

**Дата**: этап 6
**Статус**: решено (процесс)

`bunx tsc --noEmit | head -N && git commit` — pipeline возвращает код
`head`, а не `tsc`. Regex с неэкранированным `/` внутри литерала уехал в
коммит abc9d00. Исправлено в 07bf3ac.

**Правило**: проверку типов гонять без pipe перед коммитом
(`bunx tsc --noEmit && git commit ...`), либо `set -o pipefail`.

---

## P9. SQLite молча не применяет FK: каскадные удаления не работали

**Дата**: тесты (после этапа 7)
**Статус**: решено

`PRAGMA foreign_keys` в SQLite **выключен по умолчанию**. Свой driver-адаптер
открывал базу без этого pragma → `ON DELETE CASCADE` в DDL существовал, но
не выполнялся (тест «snapshot cascade-deletes with ScanRun» поймал это).

**Решение**: в `openDatabase()` адаптера и в `ensureSchema()` включать
`PRAGMA foreign_keys = ON`, плюс `busy_timeout=5000` и `journal_mode=WAL`
(по плану). Чистые юнит-тесты этого не видят — нужна интеграция с реальной
базой, поэтому `core/db.test.ts` остаётся обязательным.

---

## P10. Смоук-скрипт дублировал интеграционные тесты

**Дата**: тесты
**Статус**: решено (удалён)

`scripts/smoke.ts` повторял проверки `src/core/db.test.ts`. Удалён;
`bun run test:smoke` запускает интеграционный тест.
