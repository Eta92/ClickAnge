## Frontend — Angular 22 conventions

`application/frontend` targets Angular 22. Follow modern Angular standards for all new
and modified code. Before writing or changing Angular code, load the official guide via
the Angular CLI MCP: `get_best_practices` with `workspacePath` = the `application/frontend`
absolute path.

Key rules:
- Standalone components/directives/pipes only — no `NgModule`. Do not set `standalone: true`
  (it is the default) and do not set `changeDetection: OnPush` (also the default in v22+).
- **Signals for state, not Zone.js.** Use `signal()` / `computed()` / `linkedSignal()`,
  `input()` / `output()` / `model()`, and `toSignal()` / `toObservable()` for interop.
  Avoid `NgZone` / `zone.js`; the goal is zoneless change detection
  (`provideZonelessChangeDetection()`). When a third-party async callback must trigger
  change detection, prefer updating a signal over `ngZone.run()`.
- `inject()` over constructor injection. Prefer `@Injectable({ providedIn: 'root' })`
  (or `@Service` in v22+) for singletons.
- Native control flow (`@if` / `@for` / `@switch`), never `*ngIf` / `*ngFor` / `*ngSwitch`.
- `class` / `style` bindings, not `ngClass` / `ngStyle`. `NgOptimizedImage` for static images.
- Signal Forms (`@angular/forms/signals`) for new forms; otherwise Reactive forms.
- Lazy-load feature routes with `loadComponent` / `loadChildren`.
- Strict TypeScript; no `any` (use `unknown`); prefer inference when the type is obvious.

Current state: the app is standalone + **zoneless** (`main.ts` → `bootstrapApplication`,
`app.config.ts` → `provideZonelessChangeDetection()`, no `zone.js`). There are no
`NgModule`s and no `NgZone` usage. Keep it that way: state changes must flow through
signals (or `AsyncPipe` / `toSignal`) so change detection is notified — a plain field
mutated in an async callback will not refresh the view.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
