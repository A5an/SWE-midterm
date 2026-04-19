# AI Flow Transcript

Document: shared collaboration baseline document in `ws_123`
Actor: `usr_assanali`

## Flow 1: Rewrite with progressive streaming
1. Load the document and sign in with demo auth.
2. Select the current document text in the editor.
3. Click `Rewrite Selection`.
4. Observe `AI Job` move from queued to in-progress.
5. Observe the suggestion textarea fill progressively while the original textarea stays unchanged.
6. Wait for the stream to finish and confirm the job reaches `completed`.
7. Review the original vs suggestion compare view.
8. Optionally toggle `Edit Suggestion`, modify the suggestion text, then click `Accept`.
9. Verify the editor content changes only after explicit accept and can be reverted with `Undo Last AI Apply`.

## Flow 2: Summarize with cancel
1. Start a `Summarize Selection` request on the same document.
2. Wait until the suggestion textarea starts receiving streamed text.
3. Click `Cancel Stream`.
4. Verify the active job changes to `canceled` and the stream stops before a completed event is shown.

## Flow 3: History
1. Open the history list in the AI panel.
2. Verify the completed rewrite job appears with its status and final decision.
3. Verify the canceled summarize job remains in history with status `canceled`.
