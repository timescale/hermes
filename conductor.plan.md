# Conductor CLI Tool

Write the implementation for conductor in `index.ts`. This will be a CLI tool run on the bun runtime. It's purpose will be to automate creating branches paired with a database fork for (agentic) development work.

## Starting point

The user starts in their project root folder as the working directory. They run the command:

```bash
conductor branch "<prompt>"
```

Where `<prompt>` is a natural language description of the feature or bug fix they want to work on.

## Steps

1. We invoke claude code with the haiku model asking it to output a good branch name for the prompt. We want the branch name to be concise, lowercase, and use hyphens to separate words. For example, "add-user-authentication".
2. Check that the branch name is valid and does not already exist. If so, repeat step one with a modified prompt asking for a different branch name.
3. Create a new git worktree for the new branch. This should be placed in a subfolder of the project root called `./conductor/worktrees/<branch-name>`.
4. Ensure that the above path is in the .gitignore file.
5. Fork the production database using the `tiger svc fork` CLI command. Name the fork the same as the branch name. Pass --with-password to capture the complete connection string.
6. Copy the .env file from the project root to the new worktree folder. Replace the `DATABASE_URL` variable in the copied .env file with the connection string for the new database fork.
7. Start a docker container for the agent. Use the `conductor-sandbox` image. Just assume this is already built and available locally for now. Mount the new worktree folder into the container at `/app`. Set the working directory to `/app`. Execute claude code within the container, with the user's prompt as input.
