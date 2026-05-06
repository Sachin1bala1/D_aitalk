use serde::{Deserialize, Serialize};
use sqlparser::ast::{Expr, OrderByExpr, Query, SetExpr, Statement};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortState {
    pub column: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryTransformRequest {
    pub base_sql: String,
    pub sort: Option<SortState>,
    pub global_filter: String,
    pub null_filter: Option<String>,
    pub column_filters: HashMap<String, String>,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryTransformResponse {
    pub effective_sql: String,
}

pub fn build_effective_sql(request: &QueryTransformRequest) -> String {
    if request.base_sql.trim().is_empty() {
        return String::new();
    }

    let has_sort = request.sort.is_some();
    let has_global = !request.global_filter.trim().is_empty() && !request.columns.is_empty();
    let has_null_filter = request.null_filter.is_some();
    let has_column_filters = request
        .column_filters
        .values()
        .any(|value| !value.trim().is_empty());

    if !has_sort && !has_global && !has_null_filter && !has_column_filters {
        return trim_sql_terminator(&request.base_sql);
    }

    let Some(base_query) = parse_query(&request.base_sql) else {
        return fallback_effective_sql(request);
    };

    let wrapper_sql = format!("SELECT * FROM ({}) AS _daitalk_q", base_query);
    let Some(mut wrapped_query) = parse_query(&wrapper_sql) else {
        return fallback_effective_sql(request);
    };

    if let SetExpr::Select(select) = wrapped_query.body.as_mut() {
        let conditions = build_filter_expressions(request);
        if !conditions.is_empty() {
            select.selection = Some(combine_with_and(conditions));
        }
    }

    if let Some(sort) = &request.sort {
        if let Some(order) = parse_order_by_expr(&sort.column, &sort.direction) {
            wrapped_query.order_by = vec![order];
        } else {
            return fallback_effective_sql(request);
        }
    }

    wrapped_query.to_string()
}

fn fallback_effective_sql(request: &QueryTransformRequest) -> String {
    let mut sql = format!(
        "SELECT * FROM ({}) AS _daitalk_q",
        trim_sql_terminator(&request.base_sql)
    );

    let conditions = build_filter_condition_sql(request);
    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }

    if let Some(sort) = &request.sort {
        sql.push_str(&format!(
            " ORDER BY {} {}",
            quoted_identifier(&sort.column),
            normalize_sort_direction(&sort.direction)
        ));
    }

    sql
}

fn trim_sql_terminator(sql: &str) -> String {
    sql.trim_end().trim_end_matches(';').trim_end().to_string()
}

fn parse_query(sql: &str) -> Option<Query> {
    let dialect = GenericDialect {};
    let mut statements = Parser::parse_sql(&dialect, sql).ok()?;
    match statements.pop()? {
        Statement::Query(query) => Some(*query),
        _ => None,
    }
}

fn parse_where_expr(snippet: &str) -> Option<Expr> {
    let dialect = GenericDialect {};
    let sql = format!("SELECT * FROM __daitalk_q WHERE {snippet}");
    let mut statements = Parser::parse_sql(&dialect, &sql).ok()?;
    let Statement::Query(query) = statements.pop()? else {
        return None;
    };
    let SetExpr::Select(select) = *query.body else {
        return None;
    };
    select.selection
}

fn parse_order_by_expr(column: &str, direction: &str) -> Option<OrderByExpr> {
    let dialect = GenericDialect {};
    let sql = format!(
        "SELECT * FROM __daitalk_q ORDER BY {} {}",
        quoted_identifier(column),
        normalize_sort_direction(direction)
    );
    let mut statements = Parser::parse_sql(&dialect, &sql).ok()?;
    let Statement::Query(query) = statements.pop()? else {
        return None;
    };
    query.order_by.into_iter().next()
}

fn build_filter_expressions(request: &QueryTransformRequest) -> Vec<Expr> {
    build_filter_condition_sql(request)
        .into_iter()
        .filter_map(|condition| parse_where_expr(&condition))
        .collect()
}

fn build_filter_condition_sql(request: &QueryTransformRequest) -> Vec<String> {
    let mut conditions = Vec::new();

    if let Some(null_filter) = &request.null_filter {
        conditions.push(format!("{} IS NULL", quoted_identifier(null_filter)));
        return conditions;
    }

    if !request.global_filter.trim().is_empty() && !request.columns.is_empty() {
        let escaped_filter = escape_string_literal(request.global_filter.trim());
        let global_conditions = request
            .columns
            .iter()
            .map(|column| {
                format!(
                    "CAST({} AS TEXT) ILIKE '%{}%'",
                    quoted_identifier(column),
                    escaped_filter
                )
            })
            .collect::<Vec<_>>()
            .join(" OR ");
        conditions.push(format!("({global_conditions})"));
        return conditions;
    }

    for (column, value) in request
        .column_filters
        .iter()
        .filter(|(_, value)| !value.trim().is_empty())
    {
        let trimmed = value.trim();
        if let Some(operator) = extract_operator(trimmed) {
            let operand = trimmed[operator.len()..].trim();
            conditions.push(format!(
                "{} {} '{}'",
                quoted_identifier(column),
                operator,
                escape_string_literal(operand)
            ));
        } else {
            conditions.push(format!(
                "CAST({} AS TEXT) ILIKE '%{}%'",
                quoted_identifier(column),
                escape_string_literal(trimmed)
            ));
        }
    }

    conditions
}

fn combine_with_and(mut conditions: Vec<Expr>) -> Expr {
    let first = conditions.remove(0);
    conditions.into_iter().fold(first, |left, right| Expr::BinaryOp {
        left: Box::new(left),
        op: sqlparser::ast::BinaryOperator::And,
        right: Box::new(right),
    })
}

fn quoted_identifier(identifier: &str) -> String {
    identifier
        .split('.')
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let trimmed = part.trim();
            let normalized = if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"')
            {
                trimmed[1..trimmed.len() - 1].replace("\"\"", "\"")
            } else {
                trimmed.to_string()
            };
            let escaped = normalized.replace('"', "\"\"");
            format!("\"{escaped}\"")
        })
        .collect::<Vec<_>>()
        .join(".")
}

fn escape_string_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn extract_operator(value: &str) -> Option<&'static str> {
    [">=", "<=", "!=", ">", "<", "="]
        .into_iter()
        .find(|operator| value.starts_with(operator))
}

fn normalize_sort_direction(direction: &str) -> &'static str {
    if direction.eq_ignore_ascii_case("desc") {
        "DESC"
    } else {
        "ASC"
    }
}

#[cfg(test)]
mod tests {
    use super::{build_effective_sql, QueryTransformRequest, SortState};
    use sqlparser::ast::Statement;
    use sqlparser::dialect::GenericDialect;
    use sqlparser::parser::Parser;
    use std::collections::HashMap;

    fn request(base_sql: &str) -> QueryTransformRequest {
        QueryTransformRequest {
            base_sql: base_sql.to_string(),
            sort: None,
            global_filter: String::new(),
            null_filter: None,
            column_filters: HashMap::new(),
            columns: Vec::new(),
        }
    }

    fn assert_valid_sql(sql: &str) {
        let dialect = GenericDialect {};
        let parsed = Parser::parse_sql(&dialect, sql).expect("valid transformed SQL");
        assert!(matches!(parsed.first(), Some(Statement::Query(_))));
    }

    #[test]
    fn returns_base_sql_when_no_transform_requested() {
        let input = request("SELECT * FROM users;");
        assert_eq!(build_effective_sql(&input), "SELECT * FROM users");
    }

    #[test]
    fn wraps_and_sorts_results() {
        let mut input = request("SELECT * FROM users");
        input.sort = Some(SortState {
            column: "created_at".into(),
            direction: "desc".into(),
        });

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("ORDER BY \"created_at\" DESC"));
    }

    #[test]
    fn applies_global_filter_with_escaped_literal() {
        let mut input = request("SELECT id, name FROM users");
        input.global_filter = "o'hare".into();
        input.columns = vec!["name".into(), "email".into()];

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("CAST(\"name\" AS TEXT) ILIKE '%o''hare%'"));
        assert!(sql.contains("CAST(\"email\" AS TEXT) ILIKE '%o''hare%'"));
    }

    #[test]
    fn applies_column_operator_filters() {
        let mut input = request("SELECT * FROM metrics");
        input
            .column_filters
            .insert("value".into(), ">= 10".into());

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("\"value\" >= '10'"));
    }

    #[test]
    fn applies_null_filter() {
        let mut input = request("SELECT * FROM metrics");
        input.null_filter = Some("deleted_at".into());

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("\"deleted_at\" IS NULL"));
    }

    #[test]
    fn preserves_cte_queries_inside_wrapper() {
        let mut input = request("WITH recent AS (SELECT * FROM users) SELECT * FROM recent");
        input.sort = Some(SortState {
            column: "id".into(),
            direction: "asc".into(),
        });

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("WITH recent AS"));
        assert!(sql.contains("ORDER BY \"id\" ASC"));
    }

    #[test]
    fn quotes_qualified_identifiers_per_segment() {
        let mut input = request("SELECT * FROM public.metrics");
        input.null_filter = Some("public.metrics.deleted_at".into());
        input.sort = Some(SortState {
            column: "public.metrics.created_at".into(),
            direction: "desc".into(),
        });

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("\"public\".\"metrics\".\"deleted_at\" IS NULL"));
        assert!(sql.contains("ORDER BY \"public\".\"metrics\".\"created_at\" DESC"));
    }

    #[test]
    fn normalizes_prequoted_qualified_identifiers() {
        let mut input = request("SELECT * FROM public.metrics");
        input.null_filter = Some("\"public\".\"metrics\".\"deleted_at\"".into());
        input.sort = Some(SortState {
            column: " public . \"metrics\" . created_at ".into(),
            direction: "desc".into(),
        });

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("\"public\".\"metrics\".\"deleted_at\" IS NULL"));
        assert!(sql.contains("ORDER BY \"public\".\"metrics\".\"created_at\" DESC"));
        assert!(!sql.contains("\"\"public\"\""));
    }

    #[test]
    fn wraps_set_operations_and_applies_sort() {
        let mut input = request("SELECT id FROM a UNION ALL SELECT id FROM b");
        input.sort = Some(SortState {
            column: "id".into(),
            direction: "asc".into(),
        });

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("UNION ALL"));
        assert!(sql.contains("ORDER BY \"id\" ASC"));
    }

    #[test]
    fn preserves_existing_order_by_inside_wrapped_query() {
        let mut input = request("SELECT id, created_at FROM logs ORDER BY created_at DESC");
        input.global_filter = "warn".into();
        input.columns = vec!["id".into(), "created_at".into()];

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("ORDER BY created_at DESC"));
        assert!(sql.contains("ILIKE '%warn%'"));
    }

    #[test]
    fn handles_quoted_alias_columns_in_filter_conditions() {
        let mut input = request("SELECT value AS \"Total Count\" FROM metrics");
        input.column_filters
            .insert("Total Count".into(), ">= 5".into());

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("\"Total Count\" >= '5'"));
    }

    #[test]
    fn falls_back_to_string_wrapping_for_unparseable_sql() {
        let mut input = request("SELECT FROM");
        input.global_filter = "warn".into();
        input.columns = vec!["message".into()];
        input.sort = Some(SortState {
            column: "created_at".into(),
            direction: "desc".into(),
        });

        let sql = build_effective_sql(&input);
        assert_eq!(
            sql,
            "SELECT * FROM (SELECT FROM) AS _daitalk_q WHERE (CAST(\"message\" AS TEXT) ILIKE '%warn%') ORDER BY \"created_at\" DESC"
        );
    }

    #[test]
    fn preserves_embedded_quotes_in_identifiers() {
        let mut input = request("SELECT * FROM metrics");
        input.null_filter = Some("\"metric\"\"status\"".into());

        let sql = build_effective_sql(&input);
        assert_valid_sql(&sql);
        assert!(sql.contains("\"metric\"\"status\" IS NULL"));
    }
}
