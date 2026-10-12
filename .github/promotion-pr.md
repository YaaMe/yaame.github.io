The promotion workflow selected these replies using the rule in
[`scripts/promote-filter.mjs`](../blob/main/scripts/promote-filter.mjs).

This pull request only adds entries that are selected and absent from `main`.
It never removes an already promoted comment. Review the generated structured
runs before merging; a merge makes the replies part of the public archive.
