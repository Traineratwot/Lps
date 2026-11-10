# LPS — индекс программ для Debian/Ubuntu

CLI-утилита, которая собирает в SQLite полный индекс программной системы:
**команды, пакеты (deb / flatpak / AppImage), десктопные ярлыки с иконками и
процессы** — и связывает всё это между собой. Результат — база для просмотра
и управления установленными и запущенными программами.

## Возможности

| Сущность | Что индексируется | Источники |
|---|---|---|
| Команды | имя, пути, realPath, алиасы, builtins, alternatives | `$PATH`, shell-rc, `compgen -b`, `/etc/alternatives` |
| Документация | summary + путь к man-странице | секция NAME man-страниц, fallback `--help` |
| Пакеты | имя, версия, описание, связи | `dpkg` (status + info/\*.list), `flatpak`, AppImage |
| Ярлыки | .desktop + извлечённые иконки | XDG-каталоги, темы иконок, flatpak exports |
| Процессы | запуск, uptime, cpu, rss; снапшоты-логи | `/proc` |
| Службы systemd | юнит, состояние, автозапуск; связи с пакетом и командой | unit-файлы + `systemctl show` |

Связи: `Command → Package`, `DesktopEntry → Package/Command`,
`SystemdService → Package/Command`, `Process → Command/Package`,
история `ProcessSnapshot` по каждому скану.

**Идентичность команды — sha256 содержимого файла**: один бинарь в разных
путях (`/bin/curl` и `/usr/bin/curl`) даёт одну запись с массивами `paths`,
`names` и `aliases` (см. PROBLEMS.md P12).

## Требования

- Linux (разработано и проверено на Ubuntu; модули рассчитаны на Debian/Ubuntu)
- [Bun](https://bun.sh/) ≥ 1.4 для сборки и разработки
- root/sudo для `scan` (чужие `/proc/*/exe`, домашние каталоги, системные файлы)

## Сборка и запуск

```bash
bun install
bun run build          # prisma generate + bun build --compile → dist/lps

sudo ./dist/lps --help
sudo ./dist/lps scan               # полный скан в /var/lib/lps/lps.db
./dist/lps list packages --type deb --search git
./dist/lps show git
./dist/lps logs 1
```

Бинарник **самодостаточный** (114 МБ — Bun-рантайм внутри), без node_modules
и нативных `.node`-модулей.

## Команды CLI

```
lps init                      создать/обновить схему БД (идемпотентно)
lps scan [--only <stages>]    сканирование: commands, docs, packages, desktop, processes
        [--skip-docs] [--no-icons] [--users u1,u2]
lps list <entity>             commands | packages | desktop | processes
        [--type deb|flatpak|appimage] [--search <substr>] [--limit N] [--orphan]
lps show <target>             имя команды | pkg:<имя> | pid
lps logs <pid|name>           история снапшотов процесса
lps export [--format json|csv] [--out <file>]
lps doctor                    проверка окружения (root, dpkg, flatpak, man)
lps db path                   путь к файлу БД
```

Глобальные опции: `--db <path>`, `--data-dir <path>` (иконки),
`--users <a,b>`, `-h`, `-V`. Просмотр по `lps <cmd> --help`.

## Web UI

`lps web` поднимает локальный веб-интерфейс для просмотра индекса
(только чтение, по умолчанию `127.0.0.1:8787`):

```bash
sudo lps scan          # заполнить индекс
lps web --open         # открыть UI в браузере
lps web --port 9000    # другой порт
```

- **Программы** — карточки (иконка из .desktop, пакет, команды, запущенные
  процессы) с поиском, фильтрами по типу/иконке/запущенности и пагинацией;
- **Команды / Процессы / Службы / Ярлыки** — вкладки с таблицами и карточками;
- карточка программы/команды/процесса — детальный просмотр;
- **Документация**: чтение man-страницы и вывода `--help` прямо в UI
  (кнопки на карточке команды);
- **тёмная тема** с переключателем в шапке (сохраняется в localStorage).

```bash
bun run dev:web        # watch-пересборка фронтенда (второй терминал)
bun run dev -- web     # сервер из исходников
```

## Просмотр базы (Prisma Studio)

```bash
bunx prisma studio                     # http://localhost:51212, открывает dev.db
DATABASE_URL="file:///var/lib/lps/lps.db" bunx prisma studio   # продуктовая БД
```

Форма SQLite URL нормализуется в `prisma.config.ts` — работает с любым
из видов `file:...` / `file://...` (в Prisma 7 `studio` и `migrate` требуют
разных форм, см. PROBLEMS.md P11).

## Архитектура

```
src/
  index.ts              точка входа: парсинг argv, проверка root, диспетчеризация
  cli/                  args, help, команды (scan/query/system), UI (progress/table/style)
  core/
    config.ts           пути и опции
    db.ts               PrismaClient + embedded-миграции
    db/bun-sqlite-adapter.ts   driver-адаптер Prisma поверх bun:sqlite
    util/               fs, exec, proc, text, users
  modules/
    commands/           PATH, алиасы, builtins
    docs/               man (troff NAME), --help fallback
    distro/             DistroModule + detect + debian (dpkg, alternatives)
    sources/            flatpak, appimage (не привязаны к дистрибутиву)
    desktop/            .desktop-парсер, ярлыки, иконки
    processes/          (снапшот /proc реализован в стадии scan)
prisma/schema.prisma    схема БД (Prisma ORM 7, SQLite)
prisma/migrations/      миграции (dev) → скрипт schema:sync кладёт их в бинарник
```

**Стадии `scan`** выполняются по порядку (линковка «вперёд»):
`commands → docs → packages → desktop → processes`. Каждая стадия пишет
счётчики в `ScanRun.stats`; процессы добавляют `ProcessSnapshot` — повторные
сканы копят историю наблюдений.

**Расширяемость на другие дистрибутивы:**

```ts
// modules/distro/types.ts
interface DistroModule {
  id: string;
  detect(): Promise<boolean>;
  listPackages(): Promise<RawPackage[]>;
  listPackageFiles(pkg): Promise<string[]>;
  findPackageByPath(path): Promise<RawPackage | null>;
  pathIndex(): Promise<Map<string, string>>;   // файл → пакет (bulk-линковка)
  listAlternatives?(): Promise<RawCommand[]>;
}
```

Новый дистрибутив = новый модуль в `modules/distro/<id>/` + строка в
`modules/distro/detect.ts`. Источники пакетов (flatpak, AppImage) подключаются
независимо — они одинаковы на любом дистрибутиве.

## Разработка

### Workflow

1. **Правка схемы БД** → `bun run migrate` (создаёт миграцию + `generate`).
2. **`bun run schema:sync`** — переносит миграции в embedded-вид
   (`src/core/db/schema-sql.ts`), чтобы `lps init` работал из бинарника.
3. **`bun run verify`** — типы и тесты **без pipe** (правило из PROBLEMS.md P8:
   `tsc | head` маскирует ошибки компиляции).
4. Коммит по завершённым этапам/фичам.

В неинтерактивной среде (pipe, CI) `prisma migrate dev` отказывается работать —
создавайте миграцию вручную:

```bash
bunx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql
bun run migrate:deploy && bun run schema:sync
```

### Правила

- **Никаких нативных `.node`-зависимостей** — ломает single-file сборку.
  Весь доступ к SQLite идёт через `bun:sqlite` (см. `bun-sqlite-adapter.ts`).
- **Таймауты на все внешние вызовы** (`runCommand`: 2.5–20 с, закрытый stdin,
  лимит вывода) — скан не должен зависать на GUI-программах.
- **Прогресс-бар** для любой стадии, обрабатывающей сотни записей.
- **Upsert по натуральному ключу**, никаких дублей между сканами. Идентичность
  процесса — `@@unique([pid, startedAt])` (PID переиспользуется).
- **Дистрибутивные различия** не раскидывать по коду — держать в
  `modules/distro/` и `modules/sources/`.
- TypeScript strict, ESM, импорты с `.ts`; без комментариев, кроме случаев
  «почему» (неочевидные инварианты, обходные пути).
- Функции, которые парсят что-то снаружи, держать **чистыми**
  (`parseX(content)`) и вызывать из обёрток с I/O — это делает их тестируемыми.

### Добавление команды

1. Хелпер `runXxx(config, args, flags)` в `src/cli/commands/`.
2. Диспетчеризация в `src/index.ts` (команда + `NEEDS_ROOT` при необходимости).
3. Описание в `src/cli/help.ts` (глобальный help + help команды).

## Тесты

`bun test` — 55 тестов в 9 файлах, **без root и без сети**:

| Файл | Что проверяет |
|---|---|
| `core/util/text.test.ts` | чистка Exec-полей, первые строки, ANSI |
| `core/util/proc.test.ts` | парсинг `/proc/*/stat` (comm со скобками), cpu/uptime |
| `cli/args.test.ts` | парсер argv, флаги |
| `modules/desktop/xdg.test.ts` | парсер .desktop (локали, bool, группы) |
| `modules/docs/man.test.ts` | извлечение NAME из troff (escape, шрифты) |
| `modules/distro/debian/dpkg.test.ts` | dpkg-станзы, фильтр неустановленных |
| `modules/distro/detect.test.ts` | /etc/os-release в обеих формах (кавычки) |
| `modules/commands/aliases.test.ts` | парсер alias |
| `core/db.test.ts` | адаптер bun:sqlite (транзакции, ошибки) + Prisma-интеграция, FK cascade |

```bash
bun run test            # всё
bun run test:watch      # в watch-режиме
bun run test:smoke      # только интеграция с БД
bun run verify          # tsc + тесты (перед каждым коммитом)
```

Интеграционный тест `core/db.test.ts` уже нашёл два живых бага: не включённый
`PRAGMA foreign_keys` (каскады молча не работали) и мусорные пробелы в
`cleanExec` — держите его зелёным.

## Ограничения v1

- `scan` только добавляет/обновляет записи — удалённые пакеты остаются в БД
  как stale (см. PROBLEMS.md P7; планируется `lastSeenAt` + GC).
- man/help хранится только как summary + путь (полный текст — через `man`).
- Снапшоты процессов пишутся при каждом `scan`; демон/`watch` для периодического
  сбора — в планах.
- AppImage распаковываются при каждом scan (кэширования нет).

## Проблемы и решения

Журнал инженерных проблем по ходу разработки — в [PROBLEMS.md](./PROBLEMS.md):
выбор Prisma 7 вместо RC-восьмёрки, собственный driver-адаптер, особенности
sudo/`homedir()`, usrmerge и realpath, `PRAGMA foreign_keys` и другие.
