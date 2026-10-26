**Live app:** https://main.d3f5onvhw270a9.amplifyapp.com/

On-Track
AI that will help you in understanding what foods will be best for you to consume before and after being on the track. People tend to get confused when to eat more carbs or more protein. Especially in track and field where there are so many events, you can not be eating the same food from your teammate that runs mile races when you run sprints. The problem is what is the foods that these athletes can eat.  This new AI will help these athletes know exactly what to eat without thinking about it. All these athletes will have to do is explain their workout and if they have a race coming up the next day, and then Ai will tell them the best options for what to consume to prepare or recover.  
Corina Colmenares Bittar - CUA Busch School AI Vibe Coding Contest, Fall 2026

## AI coach (Claude)

The food plan numbers still come from the rules engine in `index.html`. Under "Tips for today", the **Why this plan?** card builds two plans for the same workout and body weight, one for a sprinter and one for a miler. It sends both to a small server function, `api/explain-plan`, which asks Claude (`claude-opus-5`) to explain why the two athletes should eat differently after that practice and which pattern fits the athlete. The Anthropic API key stays on the server and never reaches the browser.

### Deploying the function (AWS Lambda)

1. Install the dependency and zip it:
   ```
   cd api/explain-plan
   npm install
   zip -r ../explain-plan.zip .
   ```
2. In the AWS Lambda console, create a function (Node.js 20 or newer), upload `explain-plan.zip`, and set the handler to `index.handler`.
3. Under Configuration:
   - **General configuration:** set the timeout to 60 seconds.
   - **Environment variables:** add `ANTHROPIC_API_KEY` (your key from console.anthropic.com) and `ALLOWED_ORIGIN` = `https://main.d3f5onvhw270a9.amplifyapp.com`.
   - **Function URL:** create one with auth type `NONE`. Leave its CORS setting off, because the function sends its own CORS headers.
4. Paste the Function URL into `AI_ENDPOINT` in `index.html`, then commit and push. Amplify redeploys the page.

Until `AI_ENDPOINT` is set, the card still shows the sprinter vs. miler numbers, and the button says the AI coach isn't connected yet.
