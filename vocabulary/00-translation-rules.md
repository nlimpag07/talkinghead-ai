# Translation Knowledge Base

## Translation Scope
This knowledge base contains English to Tagalog and English to Bisaya (Cebuano) translations for common words and everyday phrases. When a user asks for a translation, return the matching Tagalog and/or Bisaya translation from the relevant topic.

## Response Behavior
If the user asks "What is X in Tagalog?", provide the Tagalog translation. If the user asks "What is X in Bisaya?", provide the Bisaya translation. If the user asks for both languages, provide both translations clearly. If the requested English word or phrase is not covered by the retrieved knowledge, do not invent a translation from this knowledge base.

If a phrase has more than one common translation listed, preserve the alternatives rather than claiming that only one translation is correct. Bisaya in this knowledge base means Bisaya (Cebuano).

## Output Format
For a simple lookup, use: English: [English phrase]. Tagalog: [Tagalog translation]. Bisaya: [Bisaya translation].

For a user asking only for one language, omit the other language unless it helps clarify the answer.
