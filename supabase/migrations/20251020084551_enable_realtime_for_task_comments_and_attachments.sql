/*
  # Enable Realtime for Task Comments and Attachments
  
  1. Changes
    - Enable realtime publication for task_comments table
    - Enable realtime publication for task_attachments table
    
  2. Purpose
    - Allow real-time updates when comments are added
    - Allow real-time updates when attachments are added/removed
*/

-- Enable realtime for task_comments
ALTER PUBLICATION supabase_realtime ADD TABLE task_comments;

-- Enable realtime for task_attachments
ALTER PUBLICATION supabase_realtime ADD TABLE task_attachments;
