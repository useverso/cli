<img src="https://raw.githubusercontent.com/useverso/verso/main/brand/verso-header.jpg" alt="VERSO">

# VERSO CLI

The command-line tool for [VERSO](https://github.com/useverso/verso) -- the first development framework designed for agentic coding.

VERSO CLI scaffolds the `.verso/` directory into your project and manages your development workflow: board, builds, reviews, metrics, and sync with external providers.

## Quick Start

### 1. Initialize VERSO in your project

```bash
npx @useverso/cli init
```

The interactive wizard asks about your team scale and preferred board provider, then scaffolds a `.verso/` directory with scale-aware defaults.

### 2. Load the Pilot

Open your AI coding tool (Claude Code, Cursor, Copilot, etc.) and load `.verso/agents/pilot.md` as the system prompt. The Pilot is your orchestrator -- it classifies intent, enforces the state machine, and spawns Builder/Reviewer agents.

### 3. Start working

Just talk. No commands to memorize.

```
You: "I want users to export their data as CSV"
```

The Pilot handles the rest: creates a work item, writes a spec, spawns agents, opens a PR.

## Commands

| Command | Description |
|---------|-------------|
| `verso init` | Initialize a `.verso/` directory in the current project |
| `verso board` | Manage work items on the board |
| `verso build` | Build workflow commands (start building a work item) |
| `verso review` | Review workflow commands |
| `verso ship` | Ship a work item (mark PR as merged) |
| `verso status` | Show project status overview |
| `verso metrics` | Show aggregated cost and effort metrics |
| `verso sync` | Sync board state with external services |
| `verso doctor` | Validate `.verso/` configuration and board health |
| `verso upgrade` | Upgrade `.verso/` configuration to latest templates and schema |

All commands support `--format <human|plain|json>` for scriptable output.

## What Gets Scaffolded

```
.verso/
├── config.yaml              # Project settings, autonomy levels, board provider
├── board.yaml               # Local board (source of truth for work items)
├── roadmap.yaml             # Three-horizon roadmap (NOW / NEXT / LATER)
├── state-machine.yaml       # State machine definition and transition guards
├── releases.yaml            # Release tracking
├── agents/
│   ├── pilot.md             # AI orchestrator prompt (composed during init)
│   ├── builder.md           # Builder agent prompt
│   └── reviewer.md          # Reviewer agent prompt
└── templates/
    ├── issue-feature.md     # Feature work item template
    ├── issue-bug.md         # Bug report template
    ├── issue-hotfix.md      # Hotfix template
    ├── issue-chore.md       # Chore template
    ├── spec.md              # Specification template
    └── pr.md                # Pull request template
```

This single directory is everything your project needs. Copy it, version it, share it.

## Plugin System

VERSO CLI supports plugins to extend functionality. Plugins can add new commands, integrate with external services, or customize workflows.

See [PLUGINS.md](PLUGINS.md) for the full plugin API and authoring guide.

## Configuration

All configuration lives in `.verso/config.yaml`. Key settings:

**Board provider** -- where work items are tracked:
- `local` (default) -- everything in `board.yaml`, no external dependencies
- `github` -- sync with GitHub Projects
- `linear` -- sync with Linear

**Autonomy levels** -- how much trust you place in AI agents, per work type:

```yaml
autonomy:
  feature: 2    # approve spec + PR
  bug: 3        # approve only PR
  hotfix: 3     # fast-track
  chore: 4      # full auto
```

**Scale-aware defaults** -- `verso init` adjusts defaults based on your team size. Solo developers get lighter guardrails. Larger teams get stricter review requirements and documentation standards.

## Links

- [The VERSO Paper](https://github.com/useverso/verso/blob/main/paper/VERSO.md) -- full framework specification
- [Architecture](https://github.com/useverso/verso/blob/main/docs/ARCHITECTURE.md) -- technical reference
- [Design Decisions](https://github.com/useverso/verso/blob/main/docs/DECISIONS.md) -- ADRs
- [Roadmap](https://github.com/useverso/verso/blob/main/docs/ROADMAP.md) -- what is coming next
- [Website](https://useverso.dev)

## Contributing

VERSO is in its early stages. Feedback, ideas, and contributions are welcome:

- Open an issue to discuss changes
- Submit PRs to improve the CLI or templates
- Share your experience using VERSO in your projects

## License

MIT
