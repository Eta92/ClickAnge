import { Text } from '@react-email/components';
import * as React from 'react';
import { styles } from '../theme';

// The manager's free text, with their line breaks kept in both the HTML and plain-text bodies.
export const ManagerMessage: React.FC<{ message?: string }> = ({ message }) =>
  message ? (
    <Text style={styles.message}>
      {message.split('\n').map((line, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <br /> : null}
          {line}
        </React.Fragment>
      ))}
    </Text>
  ) : null;
