# Demo Studio release: 2026.09.07-render-attempt-v6

Deploy the frontend, API, and `render-demo.js` together. The UI now checks both
the API build and the actual renderer script before allowing generation.
Updating only the frontend cannot fix server-side narration or music.

Changed application sources:

- `frontend/src/features/projectmanagement/Page.jsx`
- `frontend/src/features/projectmanagement/demoRenderState.js`
- `backend/Mahima.Api.v3.clean/Controllers/ProjectManagementController.cs`
- `backend/Mahima.Api.v3.clean/Scripts/DemoRenderer/render-demo.js`

Build the frontend using its existing production environment and deploy its
generated `dist` directory to the document root serving app.mahimaministries.in.
Publish the API with the existing deployment process, preserving the server's
configuration and secrets. Include the current `Scripts/DemoRenderer/render-demo.js`
in the API publication and restart the API service. If `ProjectDemo:RendererScriptPath`
is configured, that file takes precedence and must also be updated.

No database migration is required for this release. Completed jobs are preserved.
Each click on Generate MP4 creates a fresh queued job with the selected settings.
Old completed jobs cannot be overwritten or mistaken for a new attempt.

After deployment, the authenticated `/api/projectmanagement/demo-renderer-info`
response must contain:

```json
{
  "build": "2026.09.07-render-attempt-v6",
  "backgroundJobs": true,
  "shortVideoMode": "highlight-screens-per-scene-speech",
  "sceneSynchronizedSpeech": true,
  "rendererScriptFound": true
}
```

Verify a fresh 60-second job with a female voice and music enabled. Its render
response must confirm a new ID, `durationSeconds: 60`, and the current
`rendererBuild`. Wait for that ID to complete and download its MP4; check its actual
duration with FFprobe and listen across scene boundaries. Repeat at 90 seconds.
Previously generated files retain their original content and must be regenerated.

Regression checks:

```text
node --test frontend/src/features/projectmanagement/demoRenderState.test.mjs
node --test backend/Mahima.Api.v3.clean/Scripts/DemoRenderer/render-demo.test.js backend/Mahima.Api.v3.clean/Scripts/DemoRenderer/render-demo.integration.test.js
```

Set `FFMPEG_PATH` and `FFPROBE_PATH` to enable the media tests. They use synthetic
screens/audio and a local mock speech provider, with no paid API requests.
