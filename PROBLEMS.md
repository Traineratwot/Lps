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

---

## P11. Prisma 7: migrate и studio принимают разные формы SQLite URL

**Дата**: после этапа 7 (вопрос «почему prisma studio не работает»)
**Статус**: решено

`bunx prisma studio` падал с
`Prisma Studio is not supported for the "file:./dev.db" protocol`
(прямое совпадение с prisma/studio#1578). Проба вариантов показала:

| URL | `prisma studio` | `prisma migrate` |
|---|---|---|
| `file:./dev.db` | ✗ "not supported … protocol" | ✓ |
| `file://./dev.db` | ✓ | ✗ "unable to open database file: //./dev.db" |
| `file:///abs/path.db` | ✓ | ✓ |

Итог: каноничная форма — **абсолютный `file:///...`**. `prisma.config.ts`
нормализует любую входную форму через `normalizeSqliteUrl()`
(`src/core/db/sqlite-url.ts`).

Попутно:
- `fileURLToPath` непригоден: `file:./x` превращает в `/x`, а `file://./x`
  отвергает ("host must be localhost or empty") — ручной разбор;
- `import.meta.dir` в `prisma.config.ts` ломает загрузку конфига под Node
  (Prisma CLI грузит конфиг вне Bun) → `fileURLToPath(import.meta.url)`;
- `bun:*/node:*` внутри блочного комментария оборвал его (`*/`) — тот же
  класс ошибки, что в P8.

**Правило**: `bunx prisma studio` и `migrate` безопасно запускать в любой
форме URL — конфиг нормализует; проверка `bun run test` содержит
`sqlite-url.test.ts`.

---

## P12. Дубли команд: один бинарь в разных путях (usrmerge)

**Дата**: после lps web (заметил пользователь: «два curl — это 1 и тот же бинарь»)
**Статус**: решено

Ключ `@@unique([name, path, kind])` считал `/bin/curl` и `/usr/bin/curl`
разными командами (при usrmerge `/bin` → `/usr/bin` это один inode).
Итог: ~5900 строк вместо ~2400 реальных бинарей.

**Решение** — идентичность команды = **sha256 содержимого файла**:

- `Command.hash` — единственный уникальный ключ; `paths`/`names`/`aliases` —
  JSON-массивы (все пути, все имена, прикреплённые алиасы);
- слияние — чистая функция `mergeCommands` (modules/commands/merge.ts):
  exec/alternative группируются по хешу, алиасы цепляются к команде, которую
  вызывают (`ll='ls -alF'` → запись `ls.aliases`), builtins — синтетический
  хеш `builtin:<name>`;
- хеширование мемоизируется по (dev,ino,size,mtime) и переиспользуется из БД
  при повторных сканах;
- первичное имя: basename(realPath), пропуская «символьные» applet-имена
  (`[` у multi-call coreutils) в пользу словесных.

**Эффект**: 5919 → 2396 записей (−60%); `/bin/curl`+`/usr/bin/curl` → одна
запись с `paths=["/usr/bin/curl","/bin/curl"]`; `xtables-nft-multi` собирает
все 33 имени iptables/ebtables-симлинков.

**Примечание**: строки команд пересоздаются миграцией
`command_identity_by_content_hash` (старые данные стираются) — после
обновления нужен `sudo lps scan`.

---

## P13. Перезагрузка машины на этапе сбора docs: `--help` выполнялся от root

**Дата**: тест arm64-бинарника другом на Raspberry Pi
**Статус**: решено

На этапе `docs` выполняется `--help` для **каждой** команды из PATH (алфавитный
порядок). На Pi дважды пришли `Broadcast message from root: The system will
reboot now!` и машина перезагрузилась. Механизм: у busybox-апплетов без
поддержки long options `--help` разбирается как **связка коротких флагов**
`-h -e -l -p`; для `shutdown` флаг `-h` означает HALT. На обычных системах
(systemd) `reboot --help` печатает usage и безобиден — проблема проявляется
только на «особых» реализациях, но цена — перезагрузка.

**Защита (двухуровневая)**:

1. **denylist** (`modules/docs/safety.ts`): `reboot/shutdown/halt/poweroff/
   telinit/init`, утилиты дисков (`dd`, `mkfs.*`, `wipefs`, `fdisk`, ...),
   убийцы процессов и пользователей, `mount/umount` — для них `--help`
   **не выполняется вообще** (summary приходит из man-страницы);
2. **падение привилегий**: все вызовы `--help`/`help` и `--appimage-extract`
   выполняются от `nobody` (uid 65534), когда scan идёт от root. Злонамеренный
   или неправильно парсящий аргументы бинарь получает EPERM вместо
   системных действий; при невозможности сменить uid процесс **не
   запускается вовсе** (fail-closed).

Тесты: `safety.test.ts` (predicate + отсутствие выполнения для опасных).

**Уточнение (после спора о диагнозе)**. На systemd-системах `reboot`/`poweroff` —
симлинки на `systemctl`, их `--help` действительно безобиден (печатает usage).
Проверка позиций в алфавитной очереди docs (по нашей БД, 2390 команд):
`poweroff` 66.6%, `reboot` 71.2%, `remove-shell` 71.4%, `rename-user` ~71.4% —
как раз окно, которое видно на экране Pi в момент wall-сообщения. Broadcast
асинхронный (wall → перезагрузка ~1–2 с = 1–2 команды очереди), поэтому
метка прогресса уже успела смениться на `remove-shell`/`rename-user`.
`remove-shell` — debianutils (правит /etc/shells) и физически не может
эмитировать «The system will reboot now!» — такой wall шлют только
reboot/shutdown/poweroff/halt. Двукратное воспроизведение на одной стадии
исключает случайность (внешний таймер/апгрейд).

Виновник — реализация `reboot`/`poweroff` именно на том Pi (wrapper,
пробрасывающий аргументы в `shutdown -r now`, где `--help` становится
wall-текстом; или busybox-парсинг `--help` → связка `-h -e -l -p`).
Точную реализацию удалённо не определить — но фикс от неё **не зависит**:
denylist не выполняет эти команды вовсе, а всё остальное — от `nobody`
(даже враждебный wrapper получит EPERM на reboot-вызов).
