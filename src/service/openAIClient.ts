import OpenAI from "openai";
import { config } from "../config";

export const client = new OpenAI({
  apiKey: config.openai.key,
});
