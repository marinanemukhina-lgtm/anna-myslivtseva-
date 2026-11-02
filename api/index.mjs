import { createApp } from "../server/app.mjs";
import { createPageHandler } from "../server/page-response.mjs";
const app = createApp();
app.use(createPageHandler());
export default app;
