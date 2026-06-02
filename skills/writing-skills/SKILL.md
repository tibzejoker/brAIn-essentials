---
name: writing-skills
description: Author or distil a good SKILL.md. Use whenever you create, edit, or distil a skill from something you just did — so the new skill is actually retrievable and useful to other nodes.
---

# Writing a skill

A skill is procedural know-how (the "how"), not facts (the "what" — that's memory). Capture a reusable procedure you'd want any node to follow next time.

## Format (Agent Skills standard)
- A directory `<name>/SKILL.md`. `name` is kebab-case and MUST equal the directory name.
- YAML frontmatter with `name` + `description`, then a markdown body.

## The description is the most important line
Retrieval matches the task against the **name + description** (keyword overlap today). So the description must say **what it does AND when to use it**, with the **trigger words** a task would contain.
- Good: "Resize images in a folder to a target width. Use when asked to shrink, resize, or batch-convert images."
- Weak: "Image helper." (no triggers → never retrieved)

## Body: tight + procedural
1. A one-line goal.
2. Numbered steps (the actual procedure).
3. A short "Pitfalls" list (the mistakes you just learned to avoid).
Keep it model-agnostic — no Claude/Gemini-specific phrasing — so it ports across backends.

## When distilling from a task you did
- Trigger on a real, repeatable procedure (not a one-off).
- The node controls the frontmatter; let the model fill the steps.
- Save to the personal namespace; a human prunes later. Don't overwrite a lib-bundled skill.

## Pitfalls
- Don't dump a transcript — distil the *procedure*.
- One skill = one job. If it does three things, it's three skills.
- If you can't write a description with clear trigger words, the skill is too vague to be useful.
