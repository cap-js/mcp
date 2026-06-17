@mcp
service MCPService {
    @description: 'This is a test action which should always be there, independent of any feature toggle'
    action myAction(identifier: String) returns String;
}