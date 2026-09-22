import React from 'react';
import { Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DashboardScreen from '../screens/DashboardScreen';
import SmsDetailScreen from '../screens/SmsDetailScreen';
import NotificationsDetailScreen from '../screens/NotificationsDetailScreen';
import LocationDetailScreen from '../screens/LocationDetailScreen';
import FilesDetailScreen from '../screens/FilesDetailScreen';
import CallLogDetailScreen from '../screens/CallLogDetailScreen';
import AgentScreen from '../screens/AgentScreen';
import type { DashboardStackParamList, RootTabParamList } from './types';

const DashboardStack = createNativeStackNavigator<DashboardStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();

function DashboardStackNavigator() {
  return (
    <DashboardStack.Navigator>
      <DashboardStack.Screen
        name="DashboardHome"
        component={DashboardScreen}
        options={{ title: 'MobileUse' }}
      />
      <DashboardStack.Screen name="SmsDetail" component={SmsDetailScreen} options={{ title: 'SMS' }} />
      <DashboardStack.Screen
        name="NotificationsDetail"
        component={NotificationsDetailScreen}
        options={{ title: 'Notifications' }}
      />
      <DashboardStack.Screen
        name="LocationDetail"
        component={LocationDetailScreen}
        options={{ title: 'Location' }}
      />
      <DashboardStack.Screen name="FilesDetail" component={FilesDetailScreen} options={{ title: 'Files' }} />
      <DashboardStack.Screen
        name="CallLogDetail"
        component={CallLogDetailScreen}
        options={{ title: 'Call Log' }}
      />
    </DashboardStack.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Tab.Navigator>
      <Tab.Screen
        name="Dashboard"
        component={DashboardStackNavigator}
        options={{ headerShown: false, tabBarIcon: () => <Text style={{ fontSize: 18 }}>📊</Text> }}
      />
      <Tab.Screen
        name="Agent"
        component={AgentScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 18 }}>🤖</Text> }}
      />
    </Tab.Navigator>
  );
}
