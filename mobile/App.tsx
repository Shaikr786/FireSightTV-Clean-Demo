import React from 'react';
import { StatusBar, SafeAreaView, StyleSheet } from 'react-native';
import { MatchScreen } from './src/screens/MatchScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar hidden />
      <MatchScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#070B14' } });
