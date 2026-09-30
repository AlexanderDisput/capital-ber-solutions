INSERT INTO leads
  (submitted_at, name, first_name, last_name, email, phone, eircode, property_type, whatsapp_consent, whatsapp_sent, status, difficulty, notes)
VALUES
  ('2026-09-29T09:12:00Z', 'Jane Doe', 'Jane', 'Doe', 'jane.doe@example.com', '+353861234567', 'D13 X2F4', 'house', 1, 0, 'New', NULL, NULL),
  ('2026-09-28T14:40:00Z', 'Mark Kelly', 'Mark', 'Kelly', 'mark.kelly@example.com', '+353871234567', 'D13 Y9H1', 'apartment', 0, 0, 'Contacted', 'Easy', 'Called, said he''d confirm a date by Friday.'),
  ('2026-09-27T11:05:00Z', 'Siobhan Byrne', 'Siobhan', 'Byrne', 'siobhan.byrne@example.com', '+353851234567', 'D05 R2C3', 'new-build', 1, 1, 'Quoted', 'Medium', 'Sent quote €180, waiting to hear back.'),
  ('2026-09-25T16:20:00Z', 'Tom O''Sullivan', 'Tom', 'O''Sullivan', 'tom.osullivan@example.com', '', 'D03 K1P8', 'house', 0, 0, 'Booked', 'Easy', 'Assessment booked for 3 Oct, 10am.'),
  ('2026-09-22T08:55:00Z', 'Aoife Ryan', 'Aoife', 'Ryan', 'aoife.ryan@example.com', '+353831234567', 'D13 F4W2', 'other', 1, 0, 'Lost', 'Hard', 'Went with another assessor, budget was the issue.');
