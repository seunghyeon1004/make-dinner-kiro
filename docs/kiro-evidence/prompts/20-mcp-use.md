Use the `make-dinner` MCP server registered for this workspace (tools check_plan and schedule_plan); do not compute anything yourself and do not write any file.

1. Read recordings/sunday-roast.json and take its `raw` field as the plan.
2. Call check_plan on it and say whether it is valid.
3. Call schedule_plan twice: with the kitchen { burners: 4, ovens: 2, cooks: 1 } and with { burners: 1, ovens: 1, cooks: 1 }.
4. Report, quoting the tool results: how long each dinner takes (spanMin), how many hold_exceeded warnings each has, and which steps start at a different minute in the second kitchen. If a tool call is refused or the server is not connected, say exactly that and stop.
