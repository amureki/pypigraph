# pypigraph

Visualize Python package dependency graphs.

**[pypigraph.org](https://pypigraph.org)**

## What it is

pypigraph is a quick way to see what a Python project or package depends on, including transitive dependencies. It helps with dependency exploration, package choice, rough license/freshness review, and sharing dependency graphs.

It is a static browser app: it parses input locally, fetches package metadata directly from PyPI, and renders the graph in-browser with Graphviz WASM.

## Features

- Build a graph from a `pyproject.toml`, URL, or package name
- Explore direct and transitive dependencies interactively
- Inspect package metadata: version, license, release date, size, and dependencies
- Highlight stale releases, unknown licenses, large packages, and pinned-behind dependencies
- View summaries by depth, freshness, package size, and license
- Share graphs with URL parameters

## Limitations

pypigraph does not read lockfiles or run a full resolver. It uses the latest PyPI metadata, so the graph may differ from the exact packages installed by `uv`, `pip`, Poetry, or a lockfile with pinned versions, extras, markers, platforms, or alternate indexes.
