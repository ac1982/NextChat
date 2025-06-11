import { ModelProvider, Bedrock as BedrockConfig } from "@/app/constant";
import { getServerSideConfig } from "@/app/config/server";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "../auth";
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const ALLOWED_PATH = new Set([BedrockConfig.ChatPath]);

// Helper to get AWS Credentials
function getAwsCredentials() {
  const config = getServerSideConfig();
  if (!config.isBedrock) {
    throw new Error(
      "AWS Bedrock is not configured properly (ENABLE_AWS_BEDROCK is not true)",
    );
  }
  if (!config.bedrockAccessKeyId) {
    throw new Error("AWS Bedrock Access Key ID is missing or empty.");
  }
  if (!config.bedrockSecretAccessKey) {
    throw new Error("AWS Bedrock Secret Access Key is missing or empty.");
  }
  return {
    accessKeyId: config.bedrockAccessKeyId as string,
    secretAccessKey: config.bedrockSecretAccessKey as string,
  };
}

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[Bedrock Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");

  if (!ALLOWED_PATH.has(subpath)) {
    console.log("[Bedrock Route] forbidden path ", subpath);
    return NextResponse.json(
      { error: true, msg: "you are not allowed to request " + subpath },
      { status: 403 },
    );
  }

  // Auth check specifically for Bedrock (might not need header API key)
  const authResult = auth(req, ModelProvider.Bedrock);
  if (authResult.error) {
    return NextResponse.json(authResult, { status: 401 });
  }

  try {
    const config = getServerSideConfig();

    const bedrockRegion = config.bedrockRegion as string;
    const bedrockEndpoint = config.bedrockEndpoint;

    const client = new BedrockRuntimeClient({
      region: bedrockRegion,
      credentials: getAwsCredentials(),
      endpoint: bedrockEndpoint || undefined,
    });

    const body = await req.json();
    console.log(
      "[Bedrock] Request - Model:",
      body.model,
      "Stream:",
      body.stream,
      "Messages count:",
      body.messages?.length || 0,
    );

    // Add detailed logging for debugging
    if (body.messages && body.messages.length > 0) {
      body.messages.forEach((msg: any, index: number) => {
        console.log(`[Bedrock] Message ${index}:`, {
          role: msg.role,
          contentType: typeof msg.content,
          isArray: Array.isArray(msg.content),
          contentLength: Array.isArray(msg.content)
            ? msg.content.length
            : typeof msg.content === "string"
            ? msg.content.length
            : "unknown",
        });

        if (Array.isArray(msg.content)) {
          msg.content.forEach((item: any, itemIndex: number) => {
            console.log(`[Bedrock] Message ${index}, Item ${itemIndex}:`, {
              type: item.type,
              hasImageUrl: !!item.image_url?.url,
              urlPreview: item.image_url?.url
                ? item.image_url.url.substring(0, 50) + "..."
                : null,
            });
          });
        }
      });
    }

    const {
      messages,
      model,
      stream = false,
      temperature = 0.7,
      max_tokens,
    } = body;

    // --- Input Validation ---
    if (!model || typeof model !== "string") {
      return NextResponse.json(
        {
          error: true,
          msg: "Model parameter is required and must be a string",
        },
        { status: 400 },
      );
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        {
          error: true,
          msg: "Messages parameter is required and must be a non-empty array",
        },
        { status: 400 },
      );
    }

    // --- Payload formatting for Claude on Bedrock ---
    const isClaudeModel = model.includes("anthropic.claude");
    if (!isClaudeModel) {
      return NextResponse.json(
        { error: true, msg: "Unsupported Bedrock model: " + model },
        { status: 400 },
      );
    }

    const systemPrompts = messages.filter((msg: any) => msg.role === "system");
    const userAssistantMessages = messages.filter(
      (msg: any) => msg.role !== "system",
    );

    // Validate we have non-system messages
    if (userAssistantMessages.length === 0) {
      return NextResponse.json(
        {
          error: true,
          msg: "At least one user or assistant message is required",
        },
        { status: 400 },
      );
    }

    // Process messages and handle image fetching
    const processedMessages = await Promise.all(
      userAssistantMessages.map(async (msg: any) => {
        let content;

        if (Array.isArray(msg.content)) {
          const processedContent = await Promise.all(
            msg.content.map(async (item: any) => {
              if (item.type === "image_url") {
                console.log("[Bedrock] Processing image_url item:", item);
                // Adapt from OpenAI format to Bedrock's format
                const url = item.image_url?.url;
                if (!url) {
                  console.warn(
                    "[Bedrock] Image URL is missing in content item",
                  );
                  return null;
                }

                // Check if it's a data URL or regular URL
                const dataUrlMatch = url.match(
                  /^data:(image\/[^;]+);base64,(.+)$/,
                );
                if (dataUrlMatch) {
                  // Handle data URL (base64)
                  const mediaType = dataUrlMatch[1];
                  const base64Data = dataUrlMatch[2];

                  if (!base64Data) {
                    console.warn("[Bedrock] Empty base64 data in image URL");
                    return null;
                  }

                  const bedrockImageItem = {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mediaType,
                      data: base64Data,
                    },
                  };

                  console.log(
                    "[Bedrock] Successfully converted data URL to Bedrock format:",
                    {
                      mediaType,
                      dataLength: base64Data.length,
                    },
                  );

                  return bedrockImageItem;
                } else if (
                  url.startsWith("http://") ||
                  url.startsWith("https://")
                ) {
                  // Handle HTTP URL - fetch directly and convert to base64
                  console.log(
                    "[Bedrock] HTTP URL detected, fetching directly:",
                    url.substring(0, 50) + "...",
                  );

                  try {
                    const response = await fetch(url);
                    console.log(
                      "[Bedrock] Fetch response status:",
                      response.status,
                      response.statusText,
                    );

                    if (!response.ok) {
                      console.error(
                        "[Bedrock] Failed to fetch image:",
                        response.status,
                        response.statusText,
                      );
                      return null;
                    }

                    const blob = await response.blob();
                    console.log("[Bedrock] Blob info:", {
                      size: blob.size,
                      type: blob.type,
                    });

                    if (blob.size === 0) {
                      console.error(
                        "[Bedrock] Fetched blob is empty - cache endpoint may not be working",
                      );
                      console.log(
                        "[Bedrock] This might be a service worker cache issue - image was uploaded but cache retrieval failed",
                      );
                      return null;
                    }

                    const arrayBuffer = await blob.arrayBuffer();
                    console.log(
                      "[Bedrock] ArrayBuffer size:",
                      arrayBuffer.byteLength,
                    );

                    if (arrayBuffer.byteLength === 0) {
                      console.error("[Bedrock] ArrayBuffer is empty");
                      return null;
                    }

                    const base64Data =
                      Buffer.from(arrayBuffer).toString("base64");
                    console.log("[Bedrock] Base64 conversion:", {
                      originalSize: arrayBuffer.byteLength,
                      base64Length: base64Data.length,
                      isEmpty: !base64Data || base64Data.length === 0,
                      firstChars: base64Data.substring(0, 20),
                    });

                    if (!base64Data || base64Data.length === 0) {
                      console.error(
                        "[Bedrock] Base64 data is empty after conversion",
                      );
                      return null;
                    }

                    const mediaType = blob.type || "image/jpeg";

                    const bedrockImageItem = {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: mediaType,
                        data: base64Data,
                      },
                    };

                    console.log(
                      "[Bedrock] Successfully converted HTTP URL to Bedrock format:",
                      {
                        url: url.substring(0, 50) + "...",
                        mediaType,
                        dataLength: base64Data.length,
                        hasValidData: !!base64Data && base64Data.length > 0,
                      },
                    );

                    return bedrockImageItem;
                  } catch (error) {
                    console.error("[Bedrock] Error fetching image:", error);
                    return null;
                  }
                } else {
                  console.warn(
                    "[Bedrock] Invalid URL format:",
                    url.substring(0, 50) + "...",
                  );
                  return null;
                }
              } else {
                // Handle text content
                return item;
              }
            }),
          );

          // Filter out nulls and ensure we have content
          content = processedContent.filter(Boolean);

          // Additional validation: ensure no image objects have empty data
          content = content.filter((item: any) => {
            if (item.type === "image") {
              const hasValidData =
                item.source?.data && item.source.data.length > 0;
              if (!hasValidData) {
                console.error(
                  "[Bedrock] Filtering out image with empty data:",
                  {
                    hasSource: !!item.source,
                    hasData: !!item.source?.data,
                    dataLength: item.source?.data?.length || 0,
                  },
                );
                return false;
              }
            }
            return true;
          });

          if (content.length === 0) {
            console.warn(
              "[Bedrock] All content items were filtered out, adding empty text",
            );
            content = [{ type: "text", text: "" }];
          }

          console.log(
            "[Bedrock] Processed content for message:",
            content.length,
            "items",
          );
        } else if (typeof msg.content === "string") {
          content = [{ type: "text", text: msg.content }];
        } else {
          console.warn("[Bedrock] Unknown content type:", typeof msg.content);
          content = [{ type: "text", text: "" }];
        }

        return {
          role: msg.role,
          content: content,
        };
      }),
    );

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens:
        typeof max_tokens === "number" && max_tokens > 0 ? max_tokens : 4096,
      temperature:
        typeof temperature === "number" && temperature >= 0 && temperature <= 1
          ? temperature
          : 0.7, // Bedrock Claude accepts 0-1 range
      messages: processedMessages,
      ...(systemPrompts.length > 0 && {
        system: systemPrompts
          .map((msg: any) => {
            if (typeof msg.content === "string") {
              return msg.content;
            } else if (Array.isArray(msg.content)) {
              // Handle multimodal system prompts by extracting text
              return msg.content
                .filter((item: any) => item.type === "text")
                .map((item: any) => item.text)
                .join(" ");
            }
            return String(msg.content); // Fallback conversion
          })
          .filter(Boolean)
          .join("\n"),
      }),
    };
    // --- End Payload Formatting ---

    // Log the final payload structure (without base64 data to avoid huge logs)
    console.log("[Bedrock] Final payload structure:", {
      anthropic_version: payload.anthropic_version,
      max_tokens: payload.max_tokens,
      temperature: payload.temperature,
      messageCount: payload.messages.length,
      messages: payload.messages.map((msg: any, index: number) => ({
        index,
        role: msg.role,
        contentItems: msg.content.map((item: any) => ({
          type: item.type,
          hasData: item.type === "image" ? !!item.source?.data : !!item.text,
          mediaType: item.source?.media_type || null,
          textLength: item.text?.length || null,
          dataLength: item.source?.data?.length || null,
        })),
      })),
      hasSystem: !!(payload as any).system,
    });

    // Final validation: check for any empty images
    const hasEmptyImages = payload.messages.some((msg: any) =>
      msg.content.some(
        (item: any) =>
          item.type === "image" &&
          (!item.source?.data || item.source.data.length === 0),
      ),
    );

    if (hasEmptyImages) {
      console.error(
        "[Bedrock] Payload contains empty images, this will cause Bedrock to fail",
      );
      return NextResponse.json(
        {
          error: true,
          msg: "Image processing failed: empty image data detected",
        },
        { status: 400 },
      );
    }

    if (stream) {
      const command = new InvokeModelWithResponseStreamCommand({
        modelId: model,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
      });
      const response = await client.send(command);

      if (!response.body) {
        throw new Error("Empty response stream from Bedrock");
      }
      const responseBody = response.body;

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const event of responseBody) {
              if (event.chunk?.bytes) {
                let chunkData;
                try {
                  chunkData = JSON.parse(decoder.decode(event.chunk.bytes));
                } catch (parseError) {
                  console.error(
                    "[Bedrock] Failed to parse chunk JSON:",
                    parseError,
                  );
                  continue; // Skip malformed chunks
                }

                let responseText = "";
                let finishReason: string | null = null;

                if (
                  chunkData.type === "content_block_delta" &&
                  chunkData.delta?.type === "text_delta"
                ) {
                  responseText = chunkData.delta.text || "";
                } else if (chunkData.type === "message_stop") {
                  finishReason =
                    chunkData["amazon-bedrock-invocationMetrics"]
                      ?.outputTokenCount > 0
                      ? "stop"
                      : "length"; // Example logic
                }

                // Only send non-empty responses or finish signals
                if (responseText || finishReason) {
                  // Format as OpenAI SSE chunk
                  const sseData = {
                    id: `chatcmpl-${nanoid()}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [
                      {
                        index: 0,
                        delta: { content: responseText },
                        finish_reason: finishReason,
                      },
                    ],
                  };

                  try {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(sseData)}\n\n`),
                    );
                  } catch (enqueueError) {
                    console.error(
                      "[Bedrock] Failed to enqueue data:",
                      enqueueError,
                    );
                    break; // Stop processing if client disconnected
                  }
                }

                if (finishReason) {
                  try {
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  } catch (enqueueError) {
                    console.error(
                      "[Bedrock] Failed to enqueue [DONE]:",
                      enqueueError,
                    );
                  }
                  break; // Exit loop after stop message
                }
              }
            }
          } catch (error) {
            console.error("[Bedrock] Streaming error:", error);
            try {
              controller.error(error);
            } catch (controllerError) {
              console.error(
                "[Bedrock] Failed to signal controller error:",
                controllerError,
              );
            }
          } finally {
            try {
              controller.close();
            } catch (closeError) {
              console.error(
                "[Bedrock] Failed to close controller:",
                closeError,
              );
            }
          }
        },
      });

      return new NextResponse(readableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      // Non-streaming response
      const command = new InvokeModelCommand({
        modelId: model,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
      });
      const response = await client.send(command);

      if (!response.body) {
        throw new Error("Empty response body from Bedrock");
      }

      let responseBody;
      try {
        responseBody = JSON.parse(new TextDecoder().decode(response.body));
      } catch (parseError) {
        console.error("[Bedrock] Failed to parse response JSON:", parseError);
        throw new Error("Invalid JSON response from Bedrock");
      }

      // Validate response structure
      if (
        !responseBody.content ||
        !Array.isArray(responseBody.content) ||
        responseBody.content.length === 0
      ) {
        console.error("[Bedrock] Invalid response structure:", responseBody);
        throw new Error("Invalid response structure from Bedrock");
      }

      // Format response to match OpenAI
      const formattedResponse = {
        id: `chatcmpl-${nanoid()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: responseBody.content?.[0]?.text ?? "",
            },
            finish_reason: "stop", // Assuming stop for non-streamed
          },
        ],
        usage: {
          prompt_tokens:
            responseBody["amazon-bedrock-invocationMetrics"]?.inputTokenCount ??
            -1,
          completion_tokens:
            responseBody["amazon-bedrock-invocationMetrics"]
              ?.outputTokenCount ?? -1,
          total_tokens:
            (responseBody["amazon-bedrock-invocationMetrics"]
              ?.inputTokenCount ?? 0) +
              (responseBody["amazon-bedrock-invocationMetrics"]
                ?.outputTokenCount ?? 0) || -1,
        },
      };
      return NextResponse.json(formattedResponse);
    }
  } catch (e) {
    console.error("[Bedrock] API Handler Error:", e);
    return NextResponse.json(prettyObject(e), { status: 500 });
  }
}

// Need nanoid for unique IDs
import { nanoid } from "nanoid";
