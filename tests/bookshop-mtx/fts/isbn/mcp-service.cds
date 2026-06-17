using MCPService from '../../srv/mcp-service';

extend service MCPService with {
    @description: 'This is a test action which is only there if feature toggle is enabled'
    action myToggledAction(identifier: String) returns String;
}
