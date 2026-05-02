use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PITag {
    pub web_id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub point_type: String,
    pub engineering_units: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PIValue {
    pub timestamp: String,
    pub value: serde_json::Value,
    pub good: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TagData {
    pub web_id: String,
    pub name: String,
    pub values: Vec<PIValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CurrentValue {
    pub web_id: String,
    pub name: String,
    pub timestamp: String,
    pub value: serde_json::Value,
    pub good: bool,
}

pub struct PIClient {
    base_url: String,
    client: Client,
    username: String,
    password: String,
}

impl PIClient {
    pub fn new(base_url: &str, username: &str, password: &str, verify_ssl: bool) -> Result<Self, String> {
        let client = Client::builder()
            .danger_accept_invalid_certs(!verify_ssl)
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client,
            username: username.to_string(),
            password: password.to_string(),
        })
    }

    pub async fn search_tags(&self, query: &str, max_count: u32) -> Result<Vec<PITag>, String> {
        let url = format!("{}/search/query?q={}&count={}", self.base_url,
            urlencoding::encode(query), max_count);
        let resp = self.client.get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send().await.map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("PI search failed: {}", resp.status()));
        }

        #[derive(Deserialize)]
        struct SearchResult {
            #[serde(rename = "Items")]
            items: Vec<serde_json::Value>,
        }

        let result: SearchResult = resp.json().await.map_err(|e| e.to_string())?;
        let tags = result.items.iter().filter_map(|item| {
            Some(PITag {
                web_id: item["WebId"].as_str()?.to_string(),
                name: item["Name"].as_str().unwrap_or("").to_string(),
                description: item["Description"].as_str().unwrap_or("").to_string(),
                path: item["Path"].as_str().unwrap_or("").to_string(),
                point_type: item["PointType"].as_str().unwrap_or("Float32").to_string(),
                engineering_units: item["EngineeringUnits"].as_str().unwrap_or("").to_string(),
            })
        }).collect();
        Ok(tags)
    }

    pub async fn get_tag_history(&self, web_ids: &[String], start: &str, end: &str, interval: &str) -> Result<Vec<TagData>, String> {
        let web_id_params: String = web_ids.iter()
            .map(|id| format!("webId={}", urlencoding::encode(id)))
            .collect::<Vec<_>>().join("&");
        let url = format!("{}/streamsets/interpolated?{}&startTime={}&endTime={}&interval={}",
            self.base_url, web_id_params,
            urlencoding::encode(start), urlencoding::encode(end), urlencoding::encode(interval));

        let resp = self.client.get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send().await.map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("PI history failed: {}", resp.status()));
        }

        #[derive(Deserialize)]
        struct StreamSet {
            #[serde(rename = "Items")]
            items: Vec<serde_json::Value>,
        }

        let result: StreamSet = resp.json().await.map_err(|e| e.to_string())?;
        let data = result.items.iter().filter_map(|item| {
            let web_id = item["WebId"].as_str()?.to_string();
            let name = item["Name"].as_str().unwrap_or("").to_string();
            let values = item["Items"].as_array().map(|arr| {
                arr.iter().filter_map(|v| {
                    Some(PIValue {
                        timestamp: v["Timestamp"].as_str()?.to_string(),
                        value: v["Value"].clone(),
                        good: v["Good"].as_bool().unwrap_or(true),
                    })
                }).collect()
            }).unwrap_or_default();
            Some(TagData { web_id, name, values })
        }).collect();
        Ok(data)
    }

    pub async fn get_current_values(&self, web_ids: &[String]) -> Result<Vec<CurrentValue>, String> {
        let web_id_params: String = web_ids.iter()
            .map(|id| format!("webId={}", urlencoding::encode(id)))
            .collect::<Vec<_>>().join("&");
        let url = format!("{}/streamsets/value?{}", self.base_url, web_id_params);

        let resp = self.client.get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send().await.map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("PI current values failed: {}", resp.status()));
        }

        #[derive(Deserialize)]
        struct StreamSet {
            #[serde(rename = "Items")]
            items: Vec<serde_json::Value>,
        }

        let result: StreamSet = resp.json().await.map_err(|e| e.to_string())?;
        let values = result.items.iter().filter_map(|item| {
            let web_id = item["WebId"].as_str()?.to_string();
            let name = item["Name"].as_str().unwrap_or("").to_string();
            let ts = item["Timestamp"].as_str().unwrap_or("").to_string();
            let value = item["Value"].clone();
            let good = item["Good"].as_bool().unwrap_or(true);
            Some(CurrentValue { web_id, name, timestamp: ts, value, good })
        }).collect();
        Ok(values)
    }

    pub async fn test_connection(&self) -> Result<String, String> {
        let url = format!("{}/system/versions", self.base_url);
        let resp = self.client.get(&url)
            .basic_auth(&self.username, Some(&self.password))
            .send().await.map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok("Connected to PI Web API".to_string())
        } else {
            Err(format!("PI connection failed: {}", resp.status()))
        }
    }
}
