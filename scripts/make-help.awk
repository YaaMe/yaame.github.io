BEGIN {
    group_count = split("写作|联邦与评论|检查（CI 跑 make check）|维护|部署|本地开发", groups, /[|]/)
    for (group_index = 1; group_index <= group_count; group_index++) {
        known_groups[groups[group_index]] = 1
    }
}

function remember_target(name) {
    if (!(name in known_targets)) {
        known_targets[name] = 1
        targets[++target_count] = name
    }
}

/^\.PHONY:/ {
    declaration = $0
    while (sub(/\\[[:space:]]*$/, "", declaration)) {
        if ((getline continuation) <= 0) break
        declaration = declaration " " continuation
    }
    sub(/^\.PHONY:[[:space:]]*/, "", declaration)
    sub(/#.*/, "", declaration)
    phony_count = split(declaration, phony_targets, /[[:space:]]+/)
    for (phony_index = 1; phony_index <= phony_count; phony_index++) {
        if (phony_targets[phony_index] != "") remember_target(phony_targets[phony_index])
    }
    next
}

/^[^#[:space:]:]+:.*##/ {
    target = $0
    sub(/:.*/, "", target)
    description = substr($0, index($0, "##") + 2)
    sub(/^[[:space:]]*/, "", description)
    if (description !~ /^\[[^]]+\]/) {
        print "make help: " target ": missing group" > "/dev/stderr"
        invalid = 1
        next
    }
    group = description
    sub(/^\[/, "", group)
    sub(/\].*/, "", group)
    if (!(group in known_groups)) {
        print "make help: " target ": unknown group [" group "]" > "/dev/stderr"
        invalid = 1
        next
    }
    sub(/^\[[^]]+\][[:space:]]*/, "", description)
    remember_target(target)
    descriptions[target] = description
    target_groups[target] = group
    if (length(target) > width) width = length(target)
}

END {
    if (invalid) exit 1
    for (group_index = 1; group_index <= group_count; group_index++) {
        if (group_index > 1) print ""
        print groups[group_index]
        for (target_index = 1; target_index <= target_count; target_index++) {
            target = targets[target_index]
            if (target_groups[target] == groups[group_index]) {
                printf "  \033[36m%-*s\033[0m %s\n", width, target, descriptions[target]
            }
        }
    }
}
