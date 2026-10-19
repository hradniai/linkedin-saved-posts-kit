# Setting up the processor with the user

Run this right after the first successful download. If it downloaded nothing (the saved list is empty), skip the interview: tell the user to come back once they have saved posts, and copy the kit default to `FOLDER/processor.md` unchanged so later updates can be processed. The goal is the user's own `processor.md`: which categories their posts go into, what to pull out of them, and what to do with it. Talk in the user's language, briefly.

Never ask abstract questions about the user's plans, goals or interests. Every question is anchored on a concrete post they saved: people know why they saved a specific post much better than what they "want to learn".

## a) Short overview

Read the posts in `index.md` order (`post.json` text, author; no images). Tell the user in two or three sentences: "Downloaded N posts. They are mostly about: <three to five topics>." The topics come from the posts themselves, not from guesses about the user.

## b) Up to five recent posts

Take the first five posts of `index.md` (the most recently saved). When fewer were downloaded, use all of them and say how many there are; never download more for the interview. Five is the default so it stays short; offer more if the user wants and more exist.

For each post show: author, publication date, permalink, and the full text (no images). Then ask exactly these three questions:

1. Why did you save it?
2. Which information from it would you use?
3. How, or for what, would you use it? (for example your own workshops, tools to try, ideas for your own posts, your team's practice)

Present the posts one by one, or all at once if the user prefers. Accept short answers and "I don't know" or "no idea why I saved it" as answers; they are information too.

## c) Proposal

From the answers, propose:

- **Categories**: a short list of main categories that the posts and the overview point to. As an illustration of the kind of list meant (not a template): "AI methods", "self-development", "tools", "news in a field", "workshop material". Use the user's own words where they gave them.
- **Uses**: what to do with the extracted information, each with an output file in a subfolder of the folder (not at its top level, not under `posts/` and not in a folder whose name starts with a dot; automatic processing undoes writes there). Not limited in number. Examples: a local knowledge base of tools (`knowledge/tools.md`), of topics for the user's own communication (`knowledge/content-ideas.md`), of best practices (`knowledge/best-practices.md`); tips on tools and methods to try; examples of good and bad practice; personal productivity tips; workshop material. Propose the ones the answers imply, and others the answers suggest that the user did not name.
- **Extra fields to extract**, if the answers call for them (for example "price of the tool", "what to try first").
- **Link checks**: offer to open links found in posts to see whether they lead to real content or to a sign-up wall or sales page. Say in one sentence that this reads pages from strangers and so raises the risk of hidden instructions; default off.
- **Review**: grouped by category (default), or another format the user asks for.

Ask the user to confirm or change the proposal. One round of changes is usually enough.

## d) Write the user's processor

1. Copy the kit's `processor/saved-posts-processor.md` to `FOLDER/processor.md`.
2. Replace its Setup section with the agreed values: language, categories, extra fields, each use with its output file path (relative to the folder) and what goes there, link checks on or off with limits, review format.
3. Make sure `FOLDER/AGENTS.md` points to it (the template already does).
4. Tell the user, in substance: "It is saved in FOLDER/processor.md. Whenever you want to change it, just tell me what to change."
5. If the folder that contains FOLDER has an `AGENTS.md` or `CLAUDE.md` (the user's workspace instructions), offer to add one line there so agents working in that workspace know the material exists: the path to `FOLDER/knowledge/` and a short note on what accumulates there (the uses agreed above). Add it only with the user's consent, keep it to one line, match that file's existing format, and never create such a file if none exists.

If the user skips the interview, use the kit default unchanged: copy it to `FOLDER/processor.md` without editing Setup.

## e) Run it

Run the processor on all downloaded posts as described in INSTRUCTIONS.md ("Running the processor"). Then summarize the review in a few sentences: how many posts in which categories, which ones are worth using, what went into the output files.
