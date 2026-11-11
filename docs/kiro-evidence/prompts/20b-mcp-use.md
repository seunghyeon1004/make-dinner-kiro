Use the `make-dinner` MCP server registered for this workspace (tools check_plan and schedule_plan); do not compute anything yourself and do not write any file. Your last attempt failed because empty arrays and nulls in the plan object were dropped on the way to the server; both tools now also accept the plan as a JSON string, so pass the plan as one string.

1. Read recordings/sunday-roast.json and take its `raw` field as the plan (serialise it to a JSON string exactly, keeping every `after: []` and `holdMin: null`).
2. Call check_plan on it and say whether it is valid.
3. Call schedule_plan twice: with the kitchen { burners: 4, ovens: 2, cooks: 1 } and with { burners: 1, ovens: 1, cooks: 1 }.
4. Report, quoting the tool results: how long each dinner takes (spanMin), how many hold_exceeded warnings each has, and three steps that start at a different minute in the second kitchen. If a tool call is refused or the server is not connected, say exactly that and stop.
