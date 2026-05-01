use sqlparser::ast::{
    Assignment, Expr, Function, FunctionArg, FunctionArgExpr, GroupByExpr, Ident, JoinConstraint,
    JoinOperator, ObjectName, Query, Select, SelectItem, SetExpr, Statement, TableFactor,
    TableWithJoins,
};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

#[derive(Debug, Clone)]
pub struct QueryAnalysis {
    pub statement_type: StatementType,
    pub source_tables: Vec<String>,
    pub has_joins: bool,
    pub has_subqueries: bool,
    pub has_cte: bool,
    pub is_aggregate: bool,
    pub referenced_columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatementType {
    Select,
    Insert,
    Update,
    Delete,
    Ddl,
    Other,
}

impl QueryAnalysis {
    fn empty(statement_type: StatementType) -> Self {
        Self {
            statement_type,
            source_tables: vec![],
            has_joins: false,
            has_subqueries: false,
            has_cte: false,
            is_aggregate: false,
            referenced_columns: vec![],
        }
    }
}

pub fn analyze_query(sql: &str) -> QueryAnalysis {
    let dialect = GenericDialect {};
    let statements = match Parser::parse_sql(&dialect, sql) {
        Ok(statements) => statements,
        Err(_) => return QueryAnalysis::empty(StatementType::Other),
    };

    let Some(statement) = statements.first() else {
        return QueryAnalysis::empty(StatementType::Other);
    };

    let mut analysis = QueryAnalysis::empty(statement_type(statement));
    analyze_statement(statement, &mut analysis);
    finalize_analysis(&mut analysis);
    analysis
}

pub fn normalize_identifier(ident: &Ident) -> String {
    ident.value.clone()
}

pub fn normalize_object_name(name: &ObjectName) -> String {
    name.0
        .iter()
        .map(normalize_identifier)
        .collect::<Vec<_>>()
        .join(".")
}

fn finalize_analysis(analysis: &mut QueryAnalysis) {
    analysis.source_tables.sort();
    analysis.source_tables.dedup();
    analysis.referenced_columns.sort();
    analysis.referenced_columns.dedup();
}

fn statement_type(statement: &Statement) -> StatementType {
    match statement {
        Statement::Query(_) => StatementType::Select,
        Statement::Insert { .. } => StatementType::Insert,
        Statement::Update { .. } => StatementType::Update,
        Statement::Delete { .. } => StatementType::Delete,
        Statement::CreateTable { .. }
        | Statement::AlterTable { .. }
        | Statement::Drop { .. }
        | Statement::CreateView { .. }
        | Statement::CreateSchema { .. }
        | Statement::CreateIndex { .. }
        | Statement::CreateVirtualTable { .. } => StatementType::Ddl,
        _ => StatementType::Other,
    }
}

fn analyze_statement(statement: &Statement, analysis: &mut QueryAnalysis) {
    match statement {
        Statement::Query(query) => analyze_select_query(query, analysis),
        Statement::Insert {
            table_name, source, ..
        } => {
            analysis.source_tables.push(normalize_object_name(table_name));
            if let Some(source) = source.as_deref() {
                analyze_select_query(source, analysis);
            }
        }
        Statement::Update {
            table,
            assignments,
            from,
            selection,
            returning,
        } => {
            collect_table_with_joins(table, analysis);
            if let Some(from) = from {
                collect_table_with_joins(from, analysis);
            }
            if let Some(selection) = selection {
                collect_expr(selection, analysis);
            }
            for assignment in assignments {
                collect_assignment_target(assignment, analysis);
                collect_expr(&assignment.value, analysis);
            }
            if let Some(returning) = returning {
                collect_select_items(returning, analysis);
            }
        }
        Statement::Delete {
            from,
            using,
            selection,
            returning,
            order_by,
            limit,
            ..
        } => {
            for table in from {
                collect_table_with_joins(table, analysis);
            }
            if let Some(using) = using {
                for table in using {
                    collect_table_with_joins(table, analysis);
                }
            }
            if let Some(selection) = selection {
                collect_expr(selection, analysis);
            }
            if let Some(returning) = returning {
                collect_select_items(returning, analysis);
            }
            for order in order_by {
                collect_expr(&order.expr, analysis);
            }
            if let Some(limit) = limit {
                collect_expr(limit, analysis);
            }
        }
        _ => {}
    }
}

fn analyze_select_query(query: &Query, analysis: &mut QueryAnalysis) {
    if query.with.is_some() {
        analysis.has_cte = true;
    }
    if let Some(with) = &query.with {
        for cte in &with.cte_tables {
            analyze_select_query(&cte.query, analysis);
        }
    }

    analyze_set_expr(&query.body, analysis);

    if let Some(limit) = &query.limit {
        collect_expr(limit, analysis);
    }
    for limit_expr in &query.limit_by {
        collect_expr(limit_expr, analysis);
    }
    if let Some(offset) = &query.offset {
        collect_expr(&offset.value, analysis);
    }
    for order in &query.order_by {
        collect_expr(&order.expr, analysis);
    }
    if let Some(fetch) = &query.fetch {
        if let Some(quantity) = &fetch.quantity {
            collect_expr(quantity, analysis);
        }
    }
}

fn analyze_set_expr(expr: &SetExpr, analysis: &mut QueryAnalysis) {
    match expr {
        SetExpr::Select(select) => analyze_select(select, analysis),
        SetExpr::Query(query) => {
            analysis.has_subqueries = true;
            analyze_select_query(query, analysis);
        }
        SetExpr::SetOperation { left, right, .. } => {
            analyze_set_expr(left, analysis);
            analyze_set_expr(right, analysis);
        }
        SetExpr::Values(values) => {
            for row in &values.rows {
                for expr in row {
                    collect_expr(expr, analysis);
                }
            }
        }
        SetExpr::Insert(statement) | SetExpr::Update(statement) => analyze_statement(statement, analysis),
        SetExpr::Table(table) => {
            let name = match (&table.schema_name, &table.table_name) {
                (Some(schema), Some(table_name)) => format!("{schema}.{table_name}"),
                (None, Some(table_name)) => table_name.clone(),
                _ => String::new(),
            };
            if !name.is_empty() {
                analysis.source_tables.push(name);
            }
        }
    }
}

fn analyze_select(select: &Select, analysis: &mut QueryAnalysis) {
    collect_select_items(&select.projection, analysis);

    for table in &select.from {
        collect_table_with_joins(table, analysis);
    }
    for lateral_view in &select.lateral_views {
        collect_expr(&lateral_view.lateral_view, analysis);
    }
    if let Some(selection) = &select.selection {
        collect_expr(selection, analysis);
    }
    match &select.group_by {
        GroupByExpr::Expressions(exprs) => {
            if !exprs.is_empty() {
                analysis.is_aggregate = true;
            }
            for expr in exprs {
                collect_expr(expr, analysis);
            }
        }
        GroupByExpr::All => {
            analysis.is_aggregate = true;
        }
    }
    for expr in &select.cluster_by {
        collect_expr(expr, analysis);
    }
    for expr in &select.distribute_by {
        collect_expr(expr, analysis);
    }
    for expr in &select.sort_by {
        collect_expr(expr, analysis);
    }
    if let Some(having) = &select.having {
        analysis.is_aggregate = true;
        collect_expr(having, analysis);
    }
    if let Some(qualify) = &select.qualify {
        collect_expr(qualify, analysis);
    }
}

fn collect_select_items(items: &[SelectItem], analysis: &mut QueryAnalysis) {
    for projection in items {
        match projection {
            SelectItem::UnnamedExpr(expr) => collect_expr(expr, analysis),
            SelectItem::ExprWithAlias { expr, .. } => collect_expr(expr, analysis),
            SelectItem::QualifiedWildcard(name, _) => {
                analysis
                    .referenced_columns
                    .push(format!("{}.*", normalize_object_name(name)));
            }
            SelectItem::Wildcard(_) => analysis.referenced_columns.push("*".to_string()),
        }
    }
}

fn collect_table_with_joins(table: &TableWithJoins, analysis: &mut QueryAnalysis) {
    collect_table_factor(&table.relation, analysis);
    if !table.joins.is_empty() {
        analysis.has_joins = true;
    }
    for join in &table.joins {
        collect_table_factor(&join.relation, analysis);
        match &join.join_operator {
            JoinOperator::Inner(constraint)
            | JoinOperator::LeftOuter(constraint)
            | JoinOperator::RightOuter(constraint)
            | JoinOperator::FullOuter(constraint)
            | JoinOperator::LeftSemi(constraint)
            | JoinOperator::RightSemi(constraint)
            | JoinOperator::LeftAnti(constraint)
            | JoinOperator::RightAnti(constraint) => collect_join_constraint(constraint, analysis),
            JoinOperator::CrossJoin | JoinOperator::CrossApply | JoinOperator::OuterApply => {}
        }
    }
}

fn collect_join_constraint(constraint: &JoinConstraint, analysis: &mut QueryAnalysis) {
    match constraint {
        JoinConstraint::On(expr) => collect_expr(expr, analysis),
        JoinConstraint::Using(attrs) => {
            for attr in attrs {
                analysis.referenced_columns.push(normalize_identifier(attr));
            }
        }
        JoinConstraint::Natural | JoinConstraint::None => {}
    }
}

fn collect_table_factor(factor: &TableFactor, analysis: &mut QueryAnalysis) {
    match factor {
        TableFactor::Table { name, .. } => {
            analysis.source_tables.push(normalize_object_name(name));
        }
        TableFactor::Derived { subquery, .. } => {
            analysis.has_subqueries = true;
            analyze_select_query(subquery, analysis);
        }
        TableFactor::TableFunction { expr, .. } => collect_expr(expr, analysis),
        TableFactor::Function { args, .. } => {
            for arg in args {
                collect_function_arg(arg, analysis);
            }
        }
        TableFactor::UNNEST { array_exprs, .. } => {
            for expr in array_exprs {
                collect_expr(expr, analysis);
            }
        }
        TableFactor::JsonTable { json_expr, .. } => collect_expr(json_expr, analysis),
        TableFactor::NestedJoin {
            table_with_joins, ..
        } => {
            analysis.has_joins = true;
            collect_table_with_joins(table_with_joins, analysis);
        }
        TableFactor::Pivot {
            table,
            aggregate_function,
            ..
        } => {
            collect_table_factor(table, analysis);
            collect_expr(aggregate_function, analysis);
        }
        TableFactor::Unpivot { table, .. } => collect_table_factor(table, analysis),
    }
}

fn collect_expr(expr: &Expr, analysis: &mut QueryAnalysis) {
    match expr {
        Expr::Identifier(ident) => analysis.referenced_columns.push(normalize_identifier(ident)),
        Expr::CompoundIdentifier(parts) => analysis.referenced_columns.push(
            parts
                .iter()
                .map(normalize_identifier)
                .collect::<Vec<_>>()
                .join("."),
        ),
        Expr::BinaryOp { left, right, .. }
        | Expr::Like {
            expr: left,
            pattern: right,
            ..
        }
        | Expr::ILike {
            expr: left,
            pattern: right,
            ..
        }
        | Expr::SimilarTo {
            expr: left,
            pattern: right,
            ..
        }
        | Expr::RLike {
            expr: left,
            pattern: right,
            ..
        }
        | Expr::AnyOp {
            left,
            right,
            ..
        }
        | Expr::AllOp {
            left,
            right,
            ..
        }
        | Expr::IsDistinctFrom(left, right)
        | Expr::IsNotDistinctFrom(left, right)
        | Expr::Position { expr: left, r#in: right } => {
            collect_expr(left, analysis);
            collect_expr(right, analysis);
        }
        Expr::UnaryOp { expr, .. }
        | Expr::Nested(expr)
        | Expr::Cast { expr, .. }
        | Expr::TryCast { expr, .. }
        | Expr::SafeCast { expr, .. }
        | Expr::AtTimeZone {
            timestamp: expr, ..
        }
        | Expr::IsNull(expr)
        | Expr::IsNotNull(expr)
        | Expr::IsTrue(expr)
        | Expr::IsFalse(expr)
        | Expr::IsUnknown(expr)
        | Expr::IsNotTrue(expr)
        | Expr::IsNotFalse(expr)
        | Expr::IsNotUnknown(expr)
        | Expr::Extract { expr, .. }
        | Expr::Ceil { expr, .. }
        | Expr::Floor { expr, .. }
        | Expr::Collate { expr, .. }
        | Expr::InUnnest {
            expr,
            array_expr: _,
            ..
        } => collect_expr(expr, analysis),
        Expr::Between {
            expr, low, high, ..
        } => {
            collect_expr(expr, analysis);
            collect_expr(low, analysis);
            collect_expr(high, analysis);
        }
        Expr::InList { expr, list, .. } => {
            collect_expr(expr, analysis);
            for item in list {
                collect_expr(item, analysis);
            }
        }
        Expr::InSubquery { expr, subquery, .. } => {
            collect_expr(expr, analysis);
            analysis.has_subqueries = true;
            analyze_select_query(subquery, analysis);
        }
        Expr::Exists { subquery, .. } | Expr::Subquery(subquery) | Expr::ArraySubquery(subquery) => {
            analysis.has_subqueries = true;
            analyze_select_query(subquery, analysis);
        }
        Expr::Case {
            operand,
            conditions,
            results,
            else_result,
        } => {
            if let Some(operand) = operand {
                collect_expr(operand, analysis);
            }
            for condition in conditions {
                collect_expr(condition, analysis);
            }
            for result in results {
                collect_expr(result, analysis);
            }
            if let Some(else_result) = else_result {
                collect_expr(else_result, analysis);
            }
        }
        Expr::Function(function) => collect_function(function, analysis),
        Expr::Substring {
            expr,
            substring_from,
            substring_for,
            ..
        } => {
            collect_expr(expr, analysis);
            if let Some(expr) = substring_from {
                collect_expr(expr, analysis);
            }
            if let Some(expr) = substring_for {
                collect_expr(expr, analysis);
            }
        }
        Expr::Tuple(exprs) => {
            for expr in exprs {
                collect_expr(expr, analysis);
            }
        }
        Expr::Array(array) => {
            for expr in &array.elem {
                collect_expr(expr, analysis);
            }
        }
        Expr::JsonAccess { left, right, .. } => {
            collect_expr(left, analysis);
            collect_expr(right, analysis);
        }
        Expr::CompositeAccess { expr, key } => {
            collect_expr(expr, analysis);
            analysis.referenced_columns.push(normalize_identifier(key));
        }
        _ => {}
    }
}

fn collect_function(function: &Function, analysis: &mut QueryAnalysis) {
    analysis.is_aggregate |= is_aggregate_function(&function.name);
    for arg in &function.args {
        collect_function_arg(arg, analysis);
    }
    if let Some(filter) = &function.filter {
        collect_expr(filter, analysis);
    }
    for order in &function.order_by {
        collect_expr(&order.expr, analysis);
    }
}

fn collect_function_arg(arg: &FunctionArg, analysis: &mut QueryAnalysis) {
    match arg {
        FunctionArg::Named { arg, .. } | FunctionArg::Unnamed(arg) => match arg {
            FunctionArgExpr::Expr(expr) => collect_expr(expr, analysis),
            FunctionArgExpr::QualifiedWildcard(name) => {
                analysis
                    .referenced_columns
                    .push(format!("{}.*", normalize_object_name(name)));
            }
            FunctionArgExpr::Wildcard => analysis.referenced_columns.push("*".to_string()),
        },
    }
}

fn collect_assignment_target(assignment: &Assignment, analysis: &mut QueryAnalysis) {
    if !assignment.id.is_empty() {
        analysis.referenced_columns.push(
            assignment
                .id
                .iter()
                .map(normalize_identifier)
                .collect::<Vec<_>>()
                .join("."),
        );
    }
}

fn is_aggregate_function(name: &ObjectName) -> bool {
    let normalized = normalize_object_name(name).to_uppercase();
    matches!(
        normalized.as_str(),
        "COUNT"
            | "SUM"
            | "AVG"
            | "MIN"
            | "MAX"
            | "STDDEV"
            | "STDDEV_POP"
            | "STDDEV_SAMP"
            | "VARIANCE"
            | "VAR_POP"
            | "VAR_SAMP"
            | "ARRAY_AGG"
            | "STRING_AGG"
    )
}

#[cfg(test)]
mod tests {
    use super::{analyze_query, normalize_identifier, normalize_object_name, StatementType};
    use sqlparser::ast::{Ident, ObjectName};

    #[test]
    fn analyzes_simple_select() {
        let analysis = analyze_query("SELECT temperature, pressure FROM sensor_readings");
        assert_eq!(analysis.statement_type, StatementType::Select);
        assert_eq!(analysis.source_tables, vec!["sensor_readings"]);
        assert!(!analysis.has_joins);
        assert!(!analysis.has_cte);
        assert!(!analysis.has_subqueries);
        assert!(!analysis.is_aggregate);
        assert!(analysis.referenced_columns.contains(&"temperature".to_string()));
        assert!(analysis.referenced_columns.contains(&"pressure".to_string()));
    }

    #[test]
    fn analyzes_join_and_aggregate_query() {
        let analysis = analyze_query(
            "SELECT a.id, COUNT(b.id) FROM public.alpha a JOIN beta b ON a.id = b.alpha_id GROUP BY a.id",
        );
        assert_eq!(analysis.statement_type, StatementType::Select);
        assert!(analysis.has_joins);
        assert!(analysis.is_aggregate);
        assert!(analysis.source_tables.contains(&"public.alpha".to_string()));
        assert!(analysis.source_tables.contains(&"beta".to_string()));
    }

    #[test]
    fn analyzes_cte_and_subquery() {
        let analysis = analyze_query(
            "WITH filtered AS (SELECT id FROM orders WHERE amount > 10) SELECT * FROM filtered WHERE id IN (SELECT order_id FROM shipments)",
        );
        assert!(analysis.has_cte);
        assert!(analysis.has_subqueries);
        assert!(analysis.source_tables.contains(&"orders".to_string()));
        assert!(analysis.source_tables.contains(&"shipments".to_string()));
    }

    #[test]
    fn parse_failure_falls_back_safely() {
        let analysis = analyze_query("SELECT FROM ???");
        assert_eq!(analysis.statement_type, StatementType::Other);
        assert!(analysis.source_tables.is_empty());
        assert!(analysis.referenced_columns.is_empty());
    }

    #[test]
    fn normalizes_quoted_and_qualified_identifiers() {
        let ident = Ident::with_quote('"', "MixedCase");
        assert_eq!(normalize_identifier(&ident), "MixedCase");

        let object = ObjectName(vec![Ident::new("public"), Ident::with_quote('"', "Sensor Data")]);
        assert_eq!(normalize_object_name(&object), "public.Sensor Data");
    }
}
