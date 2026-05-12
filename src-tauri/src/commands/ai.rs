use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvidiaChatRequest {
    pub api_key: String,
    pub model: String,
    pub messages: serde_json::Value,
    #[serde(default)]
    pub tools: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct NvidiaToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct NvidiaChatResponse {
    pub text: String,
    pub tool_calls: Vec<NvidiaToolCall>,
    pub stop_reason: String,
}

fn extract_text_content(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                if item
                    .get("type")
                    .and_then(|value| value.as_str())
                    .is_some_and(|kind| kind == "text")
                {
                    item.get("text")
                        .and_then(|value| value.as_str())
                        .map(ToOwned::to_owned)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

#[tauri::command]
pub async fn nvidia_chat_completion(
    request: NvidiaChatRequest,
) -> Result<NvidiaChatResponse, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| error.to_string())?;

    let mut payload = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": false,
    });

    if let Some(tools) = request.tools {
        payload["tools"] = tools;
    }

    let response = client
        .post("https://integrate.api.nvidia.com/v1/chat/completions")
        .bearer_auth(request.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("NVIDIA API error ({}): {}", status.as_u16(), body));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let choice = parsed
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|choices| choices.first())
        .ok_or_else(|| "NVIDIA API response missing choices".to_string())?;
    let message = choice
        .get("message")
        .ok_or_else(|| "NVIDIA API response missing message".to_string())?;

    let text = extract_text_content(message.get("content").unwrap_or(&serde_json::Value::Null));
    let tool_calls = message
        .get("tool_calls")
        .and_then(|value| value.as_array())
        .map(|calls| {
            calls.iter()
                .map(|call| {
                    let id = call
                        .get("id")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let name = call
                        .get("function")
                        .and_then(|function| function.get("name"))
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let args = call
                        .get("function")
                        .and_then(|function| function.get("arguments"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("{}");
                    let input = serde_json::from_str::<serde_json::Value>(args)
                        .unwrap_or_else(|_| serde_json::json!({}));

                    NvidiaToolCall { id, name, input }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let stop_reason = if tool_calls.is_empty() {
        choice
            .get("finish_reason")
            .and_then(|value| value.as_str())
            .unwrap_or("stop")
            .to_string()
    } else {
        "tool_calls".to_string()
    };

    Ok(NvidiaChatResponse {
        text,
        tool_calls,
        stop_reason,
    })
}
