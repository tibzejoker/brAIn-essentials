---
name: summarize-thread
description: Summarize a long chat or message thread into a tight recap. Use when asked to summarize a conversation, catch someone up, or condense a thread before acting on it.
---

# Summarize a thread

Goal: turn a long back-and-forth into a recap someone can act on in 10 seconds.

## Steps
1. Read the whole thread before writing anything. Note the latest state, not just the first message.
2. Lead with the **current decision / open question**, not a chronological retelling.
3. Then list, in priority order:
   - Decisions made (who decided what).
   - Open questions / blockers (who owns each).
   - Action items (owner + what), only if explicit.
4. Drop pleasantries, duplicated points, and anything superseded later in the thread.

## Output shape
- 1 line: the headline (where things stand now).
- 3-6 bullets max. If it needs more, you're including noise.
- Name people by their role when the name isn't meaningful to the reader.

## Pitfalls
- Don't invent action items that were only hinted at; mark uncertainty.
- A later message often reverses an earlier one. Summarize the *end state*.
